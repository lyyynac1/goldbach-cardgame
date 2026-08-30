import { ActionKind, ClientMessage, ErrorCode, LastActionView, SeatStatus, ServerMessage, SeatId, WireAction } from "./protocol";
import { validateClientMessage } from "./validation";
import { buildRedactedView } from "./redactedView";
import { ACTION_TYPE_TO_KIND, wireActionToAction } from "./wireConvert";
import { Action, Card, GameState } from "../../src/engine/types";
import { applyAction, forceSkipLead, initGame, resolveAgariDiscard } from "../../src/engine/engine";
import { getLegalActions } from "../../src/engine/rules";
import { chooseAction } from "../../src/engine/bot";

const SEAT_COUNT = 4;

// オンライン対戦時のbot難易度。固定値(要件通り、部屋作成時の指定は未対応)。
const ONLINE_BOT_DIFFICULTY = "hard" as const;

// 無通信が続いた部屋を自動破棄するまでの時間。申請書の目安(30分)をデフォルトにする。
const DEFAULT_ROOM_IDLE_MS = 30 * 60 * 1000;

// 対戦終了後、部屋を破棄するまでの猶予時間。結果画面を見る時間として少し余裕を持たせる。
const GAME_END_GRACE_MS = 30 * 1000;

// 以下の演出用待機時間は、すべてクライアント側(useGameSession.ts)のソロプレイと
// 同じ値に揃えている。待機中はCPU時間を消費しない(setTimeoutでの待機はI/O待ちと
// 同様、CPU時間の課金対象外)。

// bot着手前の「考え中」待機。useGameSessionのBOT_THINK_DELAY_MSに合わせた値。
const BOT_THINK_DELAY_MS = 3000;

// パス以外に選べる手が一つも無い人間の手番を、自動でパス扱いにするまでの待機時間。
// useGameSessionのHUMAN_AUTO_PASS_DELAY_MSに合わせた値。
const HUMAN_AUTO_PASS_DELAY_MS = 50;

// 場が空でリードすら作れない場合、強制的に手番を飛ばすまでの待機時間。
// useGameSessionのFORCE_SKIP_DELAY_MSに合わせた値。
const FORCE_SKIP_DELAY_MS = 300;

// パスした状態(lastAction/passedフラグ)を見せてから次に進むまでの最小保持時間。
// useGameSessionのPASS_DISPLAY_DELAY_MSに合わせた値。
const PASS_DISPLAY_DELAY_MS = 800;

// あがり発生から、互いに素な手札を捨てる処理(resolveAgariDiscard)を行うまでの待機時間。
// useGameSessionのAGARI_DISCARD_DELAY_MSに合わせた値。
const AGARI_DISCARD_DELAY_MS = 1000;

// 人間の手番のタイムアウト。離席や、closeイベントが飛ばない切断(電波断・端末スリープ等)を
// 補完するためのもの。期限が来ても入力が無ければ自動でパス相当の処理をする。
const TURN_TIMEOUT_MS = 30 * 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
  private turnTimeoutMs: number = TURN_TIMEOUT_MS;

  // ゲーム開始前は null。startRequest 受理時に initGame される。
  // 座席ごとのbot判定は GameState.players[seat].isBot を唯一の情報源とする
  // (以前は別配列で二重管理しており、切断時のbot化がredactedViewに反映されない
  // バグの原因になっていたため、GameStateに一本化した)。
  private gameState: GameState | null = null;

  // 直前に誰が何をしたか(演出用: アニメーションの向き決定、パスの表示)。
  // forceSkipもクライアントにはPassとして見せる(見た目上は同じ「何もしなかった」なため)。
  private lastAction: LastActionView | null = null;

  // 場を流した要因の手(残像表示用)。場がちょうど今流れた直後のみ値を持ち、
  // それ以外は null にリセットする(「流れる直前の場」ではなく「流した張本人の手」)。
  private lastClearedField: Card[] | null = null;

  // recordActionが呼ばれるたびに+1する連番。部屋の生成時は0。
  // broadcastStateはrecordActionを伴わずに呼ばれることもあるため、
  // クライアントが「新しい出来事」と「同じ状態の再送」を区別するために使う。
  private seq = 0;

  // advanceAndBroadcastの多重実行防止。bot着手前にawaitで間を置くようになったため、
  // その待機中に切断イベント等で再度呼ばれても二重に進行しないようにするガード。
  private advancing = false;

  // startRequestを送れる席。最初は座席0だが、ロビー中(対戦開始前)にその席が抜けた場合、
  // 残っている最も若い席へ自動的に昇格する(そうしないと誰も対戦を開始できなくなるため)。
  private hostSeat: SeatId = 0;

  // 人間の手番タイムアウト用。待機中に新しいタイマーへ置き換わっていないかを
  // トークンで判定する(clearTimeoutだけだと非同期コールバック内での判定が難しいため)。
  private turnTimeoutHandle: ReturnType<typeof setTimeout> | null = null;
  private turnTimeoutToken = 0;

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
    const testTurnTimeoutMs = url.searchParams.get("testTurnTimeoutMs");
    if (testTurnTimeoutMs) this.turnTimeoutMs = Number(testTurnTimeoutMs);

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

      // 全員切断: 誰もいない部屋でbot同士が対戦を続けても無意味なので即座に破棄する
      if (this.seats.every((s) => s === null)) {
        await this.destroyRoom(ErrorCode.RoomClosed);
        return;
      }

      // ロビー中(対戦開始前)にホストが抜けた場合、残っている最も若い席へ自動的に昇格させる。
      // そうしないと誰もstartRequestを送れず、部屋が無通信タイマー切れまで詰んでしまう。
      if (!this.gameState && seat === this.hostSeat) {
        const nextHost = this.seats.findIndex((s) => s !== null);
        if (nextHost !== -1) this.hostSeat = nextHost as SeatId;
      }

      this.broadcastSeatUpdate();

      // 対局中にこの席が人間だった場合、再接続の猶予は設けず即座にbot化して進行を止めない
      const player = this.gameState?.players.find((p) => p.id === seat);
      if (this.gameState && !this.gameState.finished && player && !player.isBot) {
        if (this.gameState.currentPlayerId === seat) {
          // この席の手番タイムアウトが仕掛かっていたなら、即座にbot化するので不要になった
          this.clearTurnTimeout();
        }
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
    if (fromSeat !== this.hostSeat) {
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

    // 期限内にきちんと入力があったので、手番タイムアウトは解除する
    this.clearTurnTimeout();

    const applyResult = applyAction(this.gameState, fromSeat, action);
    this.gameState = applyResult.state;
    this.recordAction(fromSeat, ACTION_TYPE_TO_KIND[action.type], applyResult.fieldWasReset);
    // 人間自身の手をまず単独で配信する。advanceAndBroadcastに直接入ると、続くbotの手
    // (800ms待機はさむが)と一緒くたに配信されてしまい、この手番の結果が画面に一切
    // 表示されないまま次のbotの手で場が上書きされて見える不具合があったため。
    this.broadcastState();
    await this.advanceAndBroadcast();
  }

  /**
   * 現在のプレイヤーがbotである間、および強制スキップ・あがり後の破棄待ちの間、
   * 人間の手番が来るか対戦終了するまでサーバー側で自動的に進行させる。
   * 要件4: bot席の手番になったらサーバー側でchooseActionを実行し、適用・配信する。
   *
   * 各遷移の待機時間はすべてクライアント側(useGameSession.ts)のソロプレイに
   * 合わせている(BOT_THINK_DELAY_MS等、冒頭の定数を参照)。1手ごとに毎回stateを
   * 再配信する(まとめて最後に1回だけ、ではなく)。
   */
  private async advanceAndBroadcast() {
    if (!this.gameState) return;
    if (this.advancing) return; // 既に進行中なら二重に走らせない。状態は同じthis.gameStateを見ているので、進行中のループが続きを処理する
    this.advancing = true;

    try {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        if (this.gameState.finished) break;

        if (this.gameState.pendingAgari) {
          await sleep(AGARI_DISCARD_DELAY_MS);
          if (!this.gameState || this.gameState.finished) break;
          this.gameState = resolveAgariDiscard(this.gameState);
          this.broadcastState();
          continue;
        }

        const legal = getLegalActions(this.gameState, this.gameState.currentPlayerId);
        if (legal.length === 0) {
          await sleep(FORCE_SKIP_DELAY_MS);
          if (!this.gameState || this.gameState.finished) break;
          const skippedSeat = this.gameState.currentPlayerId;
          this.gameState = forceSkipLead(this.gameState);
          this.recordAction(skippedSeat, ActionKind.Pass, false); // forceSkipは元々場が空なので流したことにはならない
          this.broadcastState();
          continue;
        }

        const seat = this.gameState.currentPlayerId as SeatId;
        const player = this.gameState.players.find((p) => p.id === seat)!;

        if (player.isBot) {
          await sleep(BOT_THINK_DELAY_MS);
          // 待機中に部屋が破棄されている可能性があるので、抜けた直後に再確認する
          if (!this.gameState || this.gameState.finished) break;

          const action = chooseAction(this.gameState, seat, ONLINE_BOT_DIFFICULTY);
          let wasPass: boolean;
          if (action === null) {
            this.gameState = forceSkipLead(this.gameState);
            this.recordAction(seat, ActionKind.Pass, false);
            wasPass = true;
          } else {
            const applyResult = applyAction(this.gameState, seat, action);
            this.gameState = applyResult.state;
            this.recordAction(seat, ACTION_TYPE_TO_KIND[action.type], applyResult.fieldWasReset);
            wasPass = action.type === "pass";
          }
          this.broadcastState();
          if (wasPass) {
            // パスした状態を見せてから次に進む(botが連続パスすると一瞬で流れてしまうため)
            await sleep(PASS_DISPLAY_DELAY_MS);
            if (!this.gameState || this.gameState.finished) break;
          }
          continue;
        }

        // 人間の手番。パス以外に選べる手が一つも無いなら、入力を待たず自動でパスする
        if (legal.length === 1 && legal[0].type === "pass") {
          await sleep(HUMAN_AUTO_PASS_DELAY_MS);
          if (!this.gameState || this.gameState.finished) break;
          const applyResult = applyAction(this.gameState, seat, { type: "pass" });
          this.gameState = applyResult.state;
          this.recordAction(seat, ActionKind.Pass, applyResult.fieldWasReset);
          this.broadcastState();
          continue;
        }

        // 本当に入力が必要な人間の手番。タイムアウトを仕掛けて、ここで止めて入力を待つ
        this.scheduleTurnTimeout(seat);
        break;
      }
    } finally {
      this.advancing = false;
    }

    if (!this.gameState) return; // 待機中に(全員切断等で)部屋自体が破棄された

    // ループを抜けた時点(人間の手番になった、または対戦終了した)の状態を必ず1回送る。
    // 例えば最初から人間の手番でbotが一度も動かなかった場合、ループ内では
    // 一度もbroadcastStateが呼ばれないため、ここでの送信が唯一の機会になる。
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
      const view = buildRedactedView(this.gameState, seat, this.lastAction, this.lastClearedField, this.seq);
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
    this.broadcast({ type: "seatUpdate", seats, connectedCount, host: this.hostSeat });
  }

  private broadcast(msg: ServerMessage) {
    const payload = JSON.stringify(msg);
    for (const ws of this.seats) {
      if (ws) ws.send(payload);
    }
  }

  /**
   * 人間の手番タイムアウトを仕掛ける。クライアントには turnDeadline で期限を知らせる
   * (残り時間表示用)。期限までにactionが届かなければ handleTurnTimeout が自動でパス相当の
   * 処理をする。
   */
  private scheduleTurnTimeout(seat: SeatId) {
    this.clearTurnTimeout();
    const myToken = this.turnTimeoutToken;
    const deadlineAt = Date.now() + this.turnTimeoutMs;
    this.broadcast({ type: "turnDeadline", seat, deadlineAt });

    this.turnTimeoutHandle = setTimeout(() => {
      void this.handleTurnTimeout(seat, myToken);
    }, this.turnTimeoutMs);
  }

  /** 仕掛かっている手番タイムアウトを解除する(入力があった/bot化された等で不要になった場合)。 */
  private clearTurnTimeout() {
    if (this.turnTimeoutHandle !== null) {
      clearTimeout(this.turnTimeoutHandle);
      this.turnTimeoutHandle = null;
    }
    // トークンを進めておくことで、既にタイマーコールバックが実行キューに入って
    // しまっていた場合でも(clearTimeoutが間に合わなかった場合でも)、
    // 発火時のトークン照合で「もう無効」と判定できるようにする。
    this.turnTimeoutToken++;
  }

  private async handleTurnTimeout(seat: SeatId, token: number) {
    if (token !== this.turnTimeoutToken) return; // 既に解除/上書きされた古いタイマー
    if (!this.gameState || this.gameState.finished) return;
    if (this.gameState.currentPlayerId !== seat) return;
    const player = this.gameState.players.find((p) => p.id === seat);
    if (!player || player.isBot) return; // 既に切断でbot化されている等

    const legal = getLegalActions(this.gameState, seat);
    let fieldWasReset = false;
    if (legal.some((a) => a.type === "pass")) {
      const applyResult = applyAction(this.gameState, seat, { type: "pass" });
      this.gameState = applyResult.state;
      fieldWasReset = applyResult.fieldWasReset;
    } else {
      // 場が空(リード番)でpassという選択肢自体が無い場合は、強制スキップで次の人へ回す
      this.gameState = forceSkipLead(this.gameState);
    }
    this.recordAction(seat, ActionKind.Pass, fieldWasReset);
    // handleActionと同様、この手番の結果を単独で配信してからadvanceAndBroadcastに入る
    this.broadcastState();
    // パスした状態を見せてから次に進む(bot分岐と同様の演出)
    await sleep(PASS_DISPLAY_DELAY_MS);
    if (!this.gameState || this.gameState.finished) return;
    await this.advanceAndBroadcast();
  }

  private recordAction(seat: number, kind: ActionKind, fieldWasReset: boolean) {
    this.lastAction = { seat: seat as SeatId, kind };
    this.lastClearedField = fieldWasReset && this.gameState ? this.gameState.lastClearedField : null;
    this.seq++;
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
    this.clearTurnTimeout(); // 破棄後にタイマーが発火しても無害だが、念のため止めておく
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
