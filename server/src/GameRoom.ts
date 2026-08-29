import { ClientMessage, ErrorCode, SeatStatus, ServerMessage, SeatId, WireAction } from "./protocol";
import { validateClientMessage } from "./validation";
import { buildRedactedView } from "./redactedView";
import { wireActionToAction } from "./wireConvert";
import { GameState } from "../../src/engine/types";
import { applyAction, forceSkipLead, initGame, resolveAgariDiscard } from "../../src/engine/engine";
import { getLegalActions } from "../../src/engine/rules";
import { chooseAction } from "../../src/engine/bot";

const SEAT_COUNT = 4;
const HOST_SEAT: SeatId = 0;

// オンライン対戦時のbot難易度。固定値(要件通り、部屋作成時の指定は未対応)。
const ONLINE_BOT_DIFFICULTY = "hard" as const;

// 無通信が続いた部屋を自動破棄するまでの時間。申請書の目安(30分)をデフォルトにする。
const DEFAULT_ROOM_IDLE_MS = 30 * 60 * 1000;

/**
 * Durable Object 本実装。
 *
 * フェーズ1(部屋の入退室・定員・自動破棄)に加え、ここからゲームロジック本体
 * (src/engine/*)へ接続する。GameRoom はサーバー権威の GameState を1つ保持し、
 * 全ての手の合法性判定・適用はこのクラス経由でのみ行う。
 */
export class GameRoom {
  private seats: (WebSocket | null)[] = Array.from({ length: SEAT_COUNT }, () => null);
  private state: DurableObjectState;
  private idleMs: number = DEFAULT_ROOM_IDLE_MS;

  // ゲーム開始前は null。startRequest 受理時に initGame される。
  private gameState: GameState | null = null;
  // 座席ごとのbot判定。開始時に「その時点で人間が接続していない席」として確定する。
  private seatIsBot: boolean[] | null = null;

  constructor(state: DurableObjectState, _env: unknown) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected websocket upgrade", { status: 426 });
    }

    if (this.gameState !== null) {
      // このフェーズでは対戦開始後の途中参加・再接続には未対応
      return new Response("Game already started", { status: 403 });
    }

    const seat = this.seats.findIndex((s) => s === null);
    if (seat === -1) {
      return new Response("Room full", { status: 403 });
    }

    const url = new URL(request.url);
    const testIdleMs = url.searchParams.get("testIdleMs");
    if (testIdleMs) this.idleMs = Number(testIdleMs);

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    await this.acceptSession(server, seat as SeatId);
    return new Response(null, { status: 101, webSocket: client });
  }

  private async acceptSession(ws: WebSocket, seat: SeatId) {
    ws.accept();
    this.seats[seat] = ws;
    await this.bumpIdleAlarm();

    const welcome: ServerMessage = { type: "welcome", seat };
    ws.send(JSON.stringify(welcome));
    this.broadcastSeatUpdate();

    ws.addEventListener("message", async (event: MessageEvent) => {
      let raw: unknown;
      try {
        raw = JSON.parse(event.data as string);
      } catch {
        this.sendErrorAndClose(ws, ErrorCode.InvalidMessageShape);
        return;
      }

      const result = validateClientMessage(raw);
      if (!result.ok) {
        // 制約5: 規定範囲外の値を受信したら破棄して切断する
        this.sendErrorAndClose(ws, result.code);
        return;
      }

      await this.bumpIdleAlarm();
      this.handleValidMessage(seat, result.value);
    });

    const cleanup = () => {
      if (this.seats[seat] === ws) {
        this.seats[seat] = null;
        this.broadcastSeatUpdate();
      }
    };
    ws.addEventListener("close", cleanup);
    ws.addEventListener("error", cleanup);
  }

  private handleValidMessage(fromSeat: SeatId, msg: ClientMessage) {
    const ws = this.seats[fromSeat];
    if (!ws) return;

    switch (msg.type) {
      case "ping": {
        const pong: ServerMessage = { type: "pong", nonce: msg.nonce };
        ws.send(JSON.stringify(pong));
        return;
      }

      case "joinRequest": {
        const welcome: ServerMessage = { type: "welcome", seat: fromSeat };
        ws.send(JSON.stringify(welcome));
        return;
      }

      case "startRequest": {
        this.handleStartRequest(fromSeat, ws);
        return;
      }

      case "action": {
        this.handleAction(fromSeat, ws, msg.action);
        return;
      }
    }
  }

  private handleStartRequest(fromSeat: SeatId, ws: WebSocket) {
    if (fromSeat !== HOST_SEAT) {
      this.sendError(ws, ErrorCode.NotHost);
      return;
    }
    if (this.gameState !== null) {
      this.sendError(ws, ErrorCode.GameAlreadyStarted);
      return;
    }

    // この時点で人間が接続していない席はbotにする(要件2、難易度は固定でhard)
    this.seatIsBot = this.seats.map((s) => s === null);
    this.gameState = initGame(
      Array.from({ length: SEAT_COUNT }, (_, i) => ({
        name: `seat${i}`,
        isBot: this.seatIsBot![i],
      })),
      0
    );

    this.advanceAndBroadcast();
  }

  private handleAction(fromSeat: SeatId, ws: WebSocket, wireAction: WireAction) {
    if (!this.gameState || !this.seatIsBot) {
      this.sendError(ws, ErrorCode.GameNotStarted);
      return;
    }
    if (this.gameState.currentPlayerId !== fromSeat) {
      this.sendError(ws, ErrorCode.NotYourTurn);
      return;
    }
    if (this.seatIsBot[fromSeat]) {
      // bot席から人間のactionが届くことは正規のクライアントでは起こらない
      this.sendError(ws, ErrorCode.NotYourTurn);
      return;
    }

    let action;
    try {
      action = wireActionToAction(wireAction);
    } catch {
      this.sendError(ws, ErrorCode.OutOfRangeValue);
      return;
    }

    // 要件3: getLegalActionsで合法手か検証したうえでapplyActionを適用する
    const legal = getLegalActions(this.gameState, fromSeat);
    const isLegal = legal.some((a) => JSON.stringify(a) === JSON.stringify(action));
    if (!isLegal) {
      // 形式は正しいが今の場では出せない手。形式不正ではないので切断はしない。
      this.sendError(ws, ErrorCode.IllegalAction);
      return;
    }

    this.gameState = applyAction(this.gameState, fromSeat, action).state;
    this.advanceAndBroadcast();
  }

  /**
   * 現在のプレイヤーがbotである間、および強制スキップ・あがり後の破棄待ちの間、
   * 人間の手番が来るか対戦終了するまでサーバー側で自動的に進行させる。
   * 要件4: bot席の手番になったらサーバー側でchooseActionを実行し、適用・配信する。
   */
  private advanceAndBroadcast() {
    if (!this.gameState || !this.seatIsBot) return;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (this.gameState.finished) break;

      if (this.gameState.pendingAgari) {
        this.gameState = resolveAgariDiscard(this.gameState);
        continue;
      }

      const legal = getLegalActions(this.gameState, this.gameState.currentPlayerId);
      if (legal.length === 0) {
        this.gameState = forceSkipLead(this.gameState);
        continue;
      }

      const seat: number = this.gameState.currentPlayerId;
      if (!this.seatIsBot[seat]) break; // 人間の手番。ここで止めて入力を待つ

      const action = chooseAction(this.gameState, seat, ONLINE_BOT_DIFFICULTY);
      if (action === null) {
        this.gameState = forceSkipLead(this.gameState);
        continue;
      }
      this.gameState = applyAction(this.gameState, seat, action).state;
    }

    this.broadcastState();
  }

  private broadcastState() {
    if (!this.gameState) return;
    for (let seat = 0; seat < SEAT_COUNT; seat++) {
      const ws = this.seats[seat];
      if (!ws) continue;
      const view = buildRedactedView(this.gameState, seat);
      const msg: ServerMessage = { type: "state", view };
      ws.send(JSON.stringify(msg));
    }
  }

  private broadcastSeatUpdate() {
    const seats: SeatStatus[] = this.seats.map((ws, seat) => ({
      seat: seat as SeatId,
      occupied: ws !== null,
    }));
    const connectedCount = seats.filter((s) => s.occupied).length;
    const msg: ServerMessage = { type: "seatUpdate", seats, connectedCount };
    const payload = JSON.stringify(msg);
    for (const ws of this.seats) {
      if (ws) ws.send(payload);
    }
  }

  private sendError(ws: WebSocket, code: ErrorCode) {
    const err: ServerMessage = { type: "error", code };
    try {
      ws.send(JSON.stringify(err));
    } catch {
      // 送信できない状態は無視
    }
  }

  private sendErrorAndClose(ws: WebSocket, code: ErrorCode) {
    this.sendError(ws, code);
    ws.close(1008, "validation failed");
  }

  private async bumpIdleAlarm() {
    await this.state.storage.setAlarm(Date.now() + this.idleMs);
  }

  /** 制約6: 無通信が一定時間続いた部屋を自動破棄する(Alarm APIによる実装)。 */
  async alarm() {
    const closed: ServerMessage = { type: "roomClosed", code: ErrorCode.RoomClosed };
    const payload = JSON.stringify(closed);
    for (const ws of this.seats) {
      if (!ws) continue;
      try {
        ws.send(payload);
      } catch {
        // 既に切断済みなら無視
      }
      ws.close(1000, "room idle timeout");
    }
    this.seats = Array.from({ length: SEAT_COUNT }, () => null);
    this.gameState = null;
    this.seatIsBot = null;
  }
}
