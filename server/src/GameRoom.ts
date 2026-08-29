import { ClientMessage, ErrorCode, ServerMessage, SeatId } from "./protocol";
import { validateClientMessage } from "./validation";

const SEAT_COUNT = 4;

// 無通信が続いた部屋を自動破棄するまでの時間。申請書の目安(30分)をデフォルトにする。
const DEFAULT_ROOM_IDLE_MS = 30 * 60 * 1000;

/**
 * Durable Object 本実装(フェーズ1: 部屋の入退室・定員・自動破棄のみ)。
 *
 * まだゲームロジック(GameState)には接続していない。
 * action メッセージは形式チェック(validateClientMessage)まで行うが、
 * 実際に手として適用する処理はここでは行わない。
 */
export class GameRoom {
  private seats: (WebSocket | null)[] = Array.from({ length: SEAT_COUNT }, () => null);
  private state: DurableObjectState;

  constructor(state: DurableObjectState, _env: unknown) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected websocket upgrade", { status: 426 });
    }

    const seat = this.seats.findIndex((s) => s === null);
    if (seat === -1) {
      return new Response("Room full", { status: 403 });
    }

    // PoC検証専用: ?testIdleMs= が付いていれば、その値をこの部屋のidle破棄時間として使う。
    // 本番の既定値(30分)には影響しない。テストを短時間で終わらせるためだけのもの。
    const url = new URL(request.url);
    const testIdleMs = url.searchParams.get("testIdleMs");
    const idleMs = testIdleMs ? Number(testIdleMs) : DEFAULT_ROOM_IDLE_MS;

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    await this.acceptSession(server, seat as SeatId, idleMs);
    return new Response(null, { status: 101, webSocket: client });
  }

  private async acceptSession(ws: WebSocket, seat: SeatId, idleMs: number) {
    ws.accept();
    this.seats[seat] = ws;
    await this.bumpIdleAlarm(idleMs);

    const welcome: ServerMessage = { type: "welcome", seat };
    ws.send(JSON.stringify(welcome));

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

      await this.bumpIdleAlarm(idleMs);
      this.handleValidMessage(seat, result.value);
    });

    const cleanup = () => {
      if (this.seats[seat] === ws) this.seats[seat] = null;
    };
    ws.addEventListener("close", cleanup);
    ws.addEventListener("error", cleanup);
  }

  /**
   * 形式検証を通過したメッセージの処理。
   * 現フェーズでは実際のゲーム状態を持たないため、joinRequest/ping にのみ応答する。
   * action は「受理はするが、まだ何もしない」(ゲームロジック未接続のため)。
   */
  private handleValidMessage(fromSeat: SeatId, msg: ClientMessage) {
    const ws = this.seats[fromSeat];
    if (!ws) return;

    if (msg.type === "ping") {
      const pong: ServerMessage = { type: "pong", nonce: msg.nonce };
      ws.send(JSON.stringify(pong));
      return;
    }

    if (msg.type === "joinRequest") {
      const welcome: ServerMessage = { type: "welcome", seat: fromSeat };
      ws.send(JSON.stringify(welcome));
      return;
    }

    // msg.type === "action" はこのフェーズでは意図的に無処理(ゲームロジック未接続)。
  }

  private sendErrorAndClose(ws: WebSocket, code: ErrorCode) {
    const err: ServerMessage = { type: "error", code };
    try {
      ws.send(JSON.stringify(err));
    } catch {
      // 送信できない状態(既に切断中など)は無視して閉じる
    }
    ws.close(1008, "validation failed");
  }

  private async bumpIdleAlarm(idleMs: number) {
    await this.state.storage.setAlarm(Date.now() + idleMs);
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
  }
}
