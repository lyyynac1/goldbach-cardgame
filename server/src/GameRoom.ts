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

// 対戦終了後、部屋を破棄するまでの猶予時間。結果画面を見る時間として少し余裕を持たせる。
const GAME_END_GRACE_MS = 30 * 1000;

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
  private gameEndGraceMs: number = GAME_END_GRACE_MS;

  // ゲーム開始前は null。startRequest 受理時に initGame される。
  // 座席ごとのbot判定は GameState.players[seat].isBot を唯一の情報源とする
  // (以前は別配列で二重管理しており、切断時のbot化がredactedViewに反映されない
  // バグの原因になっていたため、GameStateに一本化した)。
  private gameState: GameState | null = null;

  // POST /room (要件1,3) を経由して作成された部屋かどうか。storageに永続化し、
  // DOインスタンスが再構築されても(idFromNameだけでは常にインスタンスが得られてしまうため)
  // 「作成済みかどうか」をここで別途管理する(要件4)。
  private created = false;

  constructor(state: DurableObjectState, _env: unknown) {
    this.state = state;
    // コンストラクタは async にできないため、blockConcurrencyWhile で
    // 「storageからcreatedフラグを読み終わるまで、このDOへの他のリクエストを待たせる」
    // 標準パターンを使う。
    this.state.blockConcurrencyWhile(async () => {
      this.created = (await this.state.storage.get<boolean>("created")) === true;
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // 内部専用: POST /room からのみ呼ばれる。このDOを「作成済み」として記録する。
    if (url.pathname === "/__create" && request.method === "POST") {
      if (!this.created) {
        this.created = true;
        await this.state.storage.put("created", true);
      }
      return new Response("ok", { status: 200 });
    }

    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected websocket upgrade", { status: 426 });
    }

    // 要件4: 作成済み(POST /room経由)の部屋にしか接続できない
    if (!this.created) {
      return new Response("Room not found", { status: 404 });
    }

    if (this.gameState !== null) {
      // このフェーズでは対戦開始後の途中参加・再接続には未対応
      return new Response("Game already started", { status: 403 });
    }

    const seat = this.seats.findIndex((s) => s === null);
    if (seat === -1) {
      return new Response("Room full", { status: 403 });
    }

    const testIdleMs = url.searchParams.get("testIdleMs");
    if (testIdleMs) this.idleMs = Number(testIdleMs);
    const testGameEndGraceMs = url.searchParams.get("testGameEndGraceMs");
    if (testGameEndGraceMs) this.gameEndGraceMs = Number(testGameEndGraceMs);

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

      // 対戦終了後は短い猶予タイマー(GAME_END_GRACE_MS)を優先する。
      // ここで無条件に無通信タイマー(30分)へ戻してしまうと、終了後にping等が
      // 届くたびに破棄が先延ばしになってしまうため。
      if (!this.gameState?.finished) {
        await this.bumpIdleAlarm();
      }
      await this.handleValidMessage(seat, result.value);
    });

    const cleanup = async () => {
      if (this.seats[seat] !== ws) return;
      this.seats[seat] = null;
      this.broadcastSeatUpdate();

      // 全員切断: 誰もいない部屋でbot同士が対戦を続けても無意味なので即座に破棄する
      if (this.seats.every((s) => s === null)) {
        await this.destroyRoom(ErrorCode.RoomClosed);
        return;
      }

      // 対局中にこの席が人間だった場合、再接続の猶予は設けず即座にbot化して進行を止めない
      const player = this.gameState?.players.find((p) => p.id === seat);
      if (this.gameState && !this.gameState.finished && player && !player.isBot) {
        // engine側はapplyAction等が常に新しいGameStateを返す不変の流儀なので、
        // ここも既存のstateを直接書き換えず、players配列だけ新しく作り直す
        this.gameState = {
          ...this.gameState,
          players: this.gameState.players.map((p) => (p.id === seat ? { ...p, isBot: true } : p)),
        };
        // advanceAndBroadcast が state を再配信するので、残った人間には
        // opponents[].isBot の更新として自然に伝わる
        await this.advanceAndBroadcast();
      }
    };
    ws.addEventListener("close", cleanup);
    ws.addEventListener("error", cleanup);
  }

  private async handleValidMessage(fromSeat: SeatId, msg: ClientMessage) {
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
        await this.handleStartRequest(fromSeat, ws);
        return;
      }

      case "action": {
        await this.handleAction(fromSeat, ws, msg.action);
        return;
      }
    }
  }

  private async handleStartRequest(fromSeat: SeatId, ws: WebSocket) {
    if (fromSeat !== HOST_SEAT) {
      this.sendError(ws, ErrorCode.NotHost);
      return;
    }
    if (this.gameState !== null) {
      this.sendError(ws, ErrorCode.GameAlreadyStarted);
      return;
    }

    // この時点で人間が接続していない席はbotにする(要件2、難易度は固定でhard)
    this.gameState = initGame(
      Array.from({ length: SEAT_COUNT }, (_, i) => ({
        name: `seat${i}`,
        isBot: this.seats[i] === null,
      })),
      0
    );

    await this.advanceAndBroadcast();
  }

  private async handleAction(fromSeat: SeatId, ws: WebSocket, wireAction: WireAction) {
    if (!this.gameState) {
      this.sendError(ws, ErrorCode.GameNotStarted);
      return;
    }
    if (this.gameState.currentPlayerId !== fromSeat) {
      this.sendError(ws, ErrorCode.NotYourTurn);
      return;
    }
    if (this.gameState.players.find((p) => p.id === fromSeat)?.isBot) {
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
    await this.advanceAndBroadcast();
  }

  /**
   * 現在のプレイヤーがbotである間、および強制スキップ・あがり後の破棄待ちの間、
   * 人間の手番が来るか対戦終了するまでサーバー側で自動的に進行させる。
   * 要件4: bot席の手番になったらサーバー側でchooseActionを実行し、適用・配信する。
   */
  private async advanceAndBroadcast() {
    if (!this.gameState) return;

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
      const isBot = this.gameState.players.find((p) => p.id === seat)?.isBot;
      if (!isBot) break; // 人間の手番。ここで止めて入力を待つ

      const action = chooseAction(this.gameState, seat, ONLINE_BOT_DIFFICULTY);
      if (action === null) {
        this.gameState = forceSkipLead(this.gameState);
        continue;
      }
      this.gameState = applyAction(this.gameState, seat, action).state;
    }

    this.broadcastState();

    if (this.gameState.finished) {
      // 対戦終了時は無通信タイマー(30分)を待たず、短い猶予(結果画面を見る時間)の後に破棄する
      await this.state.storage.setAlarm(Date.now() + this.gameEndGraceMs);
    }
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

  /** 制約6: 無通信が一定時間続いた部屋、または対戦終了から猶予時間が経過した部屋を自動破棄する(Alarm APIによる実装)。 */
  async alarm() {
    await this.destroyRoom(ErrorCode.RoomClosed);
  }

  /**
   * 部屋を破棄する。接続中の全員へ roomClosed を送ってから切断し、
   * 永続化されたストレージも削除する(以後この招待コードでの接続は
   * 「未作成の部屋」として404で拒否される)。
   *
   * 呼び出し元: Alarm発火時(無通信タイムアウト/対戦終了後の猶予経過)、
   * および全員切断時(誰もいない部屋でbot同士の対戦を続けても無意味なため)。
   */
  private async destroyRoom(reason: ErrorCode) {
    const closed: ServerMessage = { type: "roomClosed", code: reason };
    const payload = JSON.stringify(closed);
    for (const ws of this.seats) {
      if (!ws) continue;
      try {
        ws.send(payload);
      } catch {
        // 既に切断済みなら無視
      }
      ws.close(1000, "room closed");
    }
    this.seats = Array.from({ length: SEAT_COUNT }, () => null);
    this.gameState = null;
    this.created = false;
    await this.state.storage.deleteAll();
  }
}
