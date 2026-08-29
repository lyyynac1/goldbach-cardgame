/**
 * applyAction を呼ぶ前段に置く shape validation。
 *
 * ここで扱うのは「メッセージとして構造・型・値域が正しいか」だけ。
 * 「今の場でその手が合法か」はゲーム状態に依存するため、ここでは判定しない
 * (ゲームロジック接続後、getLegalActions側の責務とする)。
 *
 * 違反したメッセージは ok:false を返す。呼び出し側はこれを見て
 * 即座に接続を切断すること(申請書の制約5: 破棄して通信を切断する)。
 */
import { ActionKind, ClientMessage, ErrorCode, WireAction, WireCard } from "./protocol";

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; code: ErrorCode };

function ok<T>(value: T): ValidationResult<T> {
  return { ok: true, value };
}
function reject<T>(code: ErrorCode): ValidationResult<T> {
  return { ok: false, code };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isSmallInt(v: unknown, min: number, max: number): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
}

// 出せる枚数はゲームルール上 1〜3 で確定している(lead/beat=2or3, divisor=1or2, pass=0)。
// これより広い配列が来た時点で、正規のクライアントからはあり得ない値として拒否する。
const MAX_CARDS_PER_ACTION = 3;

function validateWireCard(raw: unknown): ValidationResult<WireCard> {
  if (!isPlainObject(raw)) return reject(ErrorCode.InvalidMessageShape);
  if (!isSmallInt(raw.s, 0, 3)) return reject(ErrorCode.OutOfRangeValue);
  if (!isSmallInt(raw.r, 1, 13)) return reject(ErrorCode.OutOfRangeValue);
  return ok({ s: raw.s, r: raw.r });
}

const VALID_KINDS = [ActionKind.Lead, ActionKind.Beat, ActionKind.Divisor, ActionKind.Pass];

// kind ごとに許容されるカード枚数(ゲームルール由来。field.lastPlayCount依存の細かい判定は
// ゲームロジック接続後に getLegalActions 側で行うので、ここでは「あり得る範囲」だけ見る)
function isCardCountAllowedForKind(kind: ActionKind, count: number): boolean {
  switch (kind) {
    case ActionKind.Pass:
      return count === 0;
    case ActionKind.Lead:
    case ActionKind.Beat:
      return count === 2 || count === 3;
    case ActionKind.Divisor:
      return count === 1 || count === 2;
    default:
      return false;
  }
}

export function validateWireAction(raw: unknown): ValidationResult<WireAction> {
  if (!isPlainObject(raw)) return reject(ErrorCode.InvalidMessageShape);

  const { kind, cards } = raw;
  if (typeof kind !== "number" || !VALID_KINDS.includes(kind)) {
    return reject(ErrorCode.OutOfRangeValue);
  }
  if (!Array.isArray(cards)) return reject(ErrorCode.InvalidMessageShape);
  if (cards.length > MAX_CARDS_PER_ACTION) return reject(ErrorCode.OutOfRangeValue);
  if (!isCardCountAllowedForKind(kind, cards.length)) return reject(ErrorCode.OutOfRangeValue);

  const parsedCards: WireCard[] = [];
  const seen = new Set<string>();
  for (const c of cards) {
    const result = validateWireCard(c);
    if (!result.ok) return result;
    const key = `${result.value.s}-${result.value.r}`;
    if (seen.has(key)) return reject(ErrorCode.OutOfRangeValue); // 同じカードを重複して出す不正
    seen.add(key);
    parsedCards.push(result.value);
  }

  return ok({ kind, cards: parsedCards });
}

const MAX_NONCE = Number.MAX_SAFE_INTEGER;

export function validateClientMessage(raw: unknown): ValidationResult<ClientMessage> {
  if (!isPlainObject(raw)) return reject(ErrorCode.InvalidMessageShape);

  switch (raw.type) {
    case "joinRequest":
      return ok({ type: "joinRequest" });

    case "ping": {
      if (typeof raw.nonce !== "number" || !Number.isFinite(raw.nonce) || raw.nonce < 0 || raw.nonce > MAX_NONCE) {
        return reject(ErrorCode.OutOfRangeValue);
      }
      return ok({ type: "ping", nonce: raw.nonce });
    }

    case "action": {
      const result = validateWireAction(raw.action);
      if (!result.ok) return result;
      return ok({ type: "action", action: result.value });
    }

    default:
      // 未知の type (自由文字列を含む)は一律で形式不正として拒否する
      return reject(ErrorCode.InvalidMessageShape);
  }
}
