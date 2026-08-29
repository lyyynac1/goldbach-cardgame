/**
 * クライアント ⇔ Durable Object の通信プロトコル型定義。
 *
 * 申請書の制約を踏まえた設計方針:
 *   1. 自由入力の文字列は一切運ばない。type 判別子は「閉じた文字列union」のみ
 *      (= 事前に定義した固定の値しか取り得ないので、チャット等の自由記述経路にはならない)。
 *      ゲームデータ本体(カード・選択肢)は完全に数値のみで表現する。
 *   4. プレイヤーの識別は座席番号(0-3)のみ。名前・アカウント・端末情報は一切含めない。
 *   8. エラー・切断の理由は数値コード(ErrorCode)で送る。実際に画面へ出す文言は
 *      クライアント側が code → 固定文言のマップを持って表示する
 *      (「サービスは停止しました」等をサーバーの自由文字列として送らない)。
 *
 * 内部の src/engine/types.ts の Card/Action 型はこのファイルの都合で変更しない。
 * 変換は server 側・client 側それぞれの境界層(まだ未実装)で行う想定。
 */

// ============================================================
// カード・行動の数値エンコーディング
// ============================================================

/** src/engine/types.ts の Suit と同じ並び順で 0-3 に対応させる */
export const WIRE_SUITS = ["spade", "heart", "diamond", "club"] as const;

/** suit(0-3) + rank(1-13) の組。文字列を一切含まない、内部Cardの通信表現。 */
export interface WireCard {
  s: number; // 0=spade 1=heart 2=diamond 3=club
  r: number; // 1-13
}

/** 内部 Action.type ("lead"|"beat"|"divisor") を数値化したもの。pass は cards なしの action として表現する。 */
export const enum ActionKind {
  Lead = 0,
  Beat = 1,
  Divisor = 2,
  Pass = 3,
}

export interface WireAction {
  kind: ActionKind;
  cards: WireCard[]; // Pass のときは常に空配列
}

// ============================================================
// 座席・入室
// ============================================================

/** 招待コード = Durable Object の ID そのもの。文字種・文字数は境界でチェックする(下記 validation.ts で規定)。 */
export type SeatId = 0 | 1 | 2 | 3;

// ============================================================
// サーバーから見た「手札を伏せたビュー」
// ============================================================

/** 自分以外のプレイヤーは手札の中身を送らず、枚数だけを送る。 */
export interface OpponentSeatView {
  seat: SeatId;
  isBot: boolean;
  handCount: number;
  passed: boolean;
}

export interface FieldView {
  cards: WireCard[];
  table: number | null;
  score: number | null;
  lastPlayCount: number;
}

/** プレイヤーごとに個別生成して送る、視点付きゲーム状態。自分の手札(hand)だけ実データを持つ。 */
export interface RedactedGameStateView {
  selfSeat: SeatId;
  selfHand: WireCard[];
  opponents: OpponentSeatView[]; // 自分以外の座席、seat昇順
  field: FieldView;
  currentSeat: SeatId;
  finished: boolean;
  winnerSeat: SeatId | null;
  pendingAgariSeat: SeatId | null;
}

// ============================================================
// エラーコード(サーバー→クライアント、自由文字列を持たない)
// ============================================================

export const enum ErrorCode {
  InvalidMessageShape = 1, // メッセージの形式が不正(型・必須フィールド欠落など)
  IllegalAction = 2, // 合法手ではない行動
  OutOfRangeValue = 3, // 数値が想定範囲外(rank範囲外、cards配列長異常など)
  NotYourTurn = 4,
  RoomFull = 5,
  RoomNotFound = 6,
  RoomClosed = 7, // 対戦終了 or Alarmによる自動破棄
}

// ============================================================
// クライアント → サーバー
// ============================================================

export type ClientMessage =
  | { type: "joinRequest" } // WebSocket接続確立後、最初に送る。ペイロードなし(招待コードは接続先URLで既に特定済み)
  | { type: "action"; action: WireAction }
  | { type: "ping"; nonce: number };

// ============================================================
// サーバー → クライアント
// ============================================================

export type ServerMessage =
  | { type: "welcome"; seat: SeatId }
  | { type: "state"; view: RedactedGameStateView }
  | { type: "error"; code: ErrorCode } // 送信元はこの直後に切断される想定
  | { type: "roomClosed"; code: ErrorCode }
  | { type: "pong"; nonce: number };

// ============================================================
// エコー確認(PoC専用。ゲームロジックとは無関係、DOの疎通確認のためだけの型)
// ============================================================

export type EchoClientMessage = { type: "echoPing"; nonce: number };
export type EchoServerMessage = { type: "echoPong"; nonce: number; fromSeat: SeatId };
