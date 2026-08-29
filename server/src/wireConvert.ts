/**
 * 内部の Card/Action(src/engine/types.ts) と、通信用の数値表現(protocol.ts)を
 * 相互変換する境界層。内部型そのものは一切変更しない。
 *
 * 重要: wireToCard / wireActionToAction は「既に validation.ts で形式・値域の
 * チェックを通過した値」にのみ使うこと。未検証の生データに対して直接呼ばない。
 */
import { Action, Card } from "../../src/engine/types";
import { ActionKind, WIRE_SUITS, WireAction, WireCard } from "./protocol";

export function cardToWire(card: Card): WireCard {
  return { s: WIRE_SUITS.indexOf(card.suit), r: card.rank };
}

export function wireToCard(w: WireCard): Card {
  const suit = WIRE_SUITS[w.s];
  if (!suit) throw new Error(`invalid wire suit index: ${w.s}`);
  return { suit, rank: w.r };
}

const KIND_TO_ACTION_TYPE = {
  [ActionKind.Lead]: "lead",
  [ActionKind.Beat]: "beat",
  [ActionKind.Divisor]: "divisor",
  [ActionKind.Pass]: "pass",
} as const;

const ACTION_TYPE_TO_KIND: Record<Action["type"], ActionKind> = {
  lead: ActionKind.Lead,
  beat: ActionKind.Beat,
  divisor: ActionKind.Divisor,
  pass: ActionKind.Pass,
};

export function actionToWire(action: Action): WireAction {
  if (action.type === "pass") {
    return { kind: ActionKind.Pass, cards: [] };
  }
  return { kind: ACTION_TYPE_TO_KIND[action.type], cards: action.cards.map(cardToWire) };
}

/** 検証済みの WireAction を内部 Action に変換する。未検証データには使わないこと。 */
export function wireActionToAction(w: WireAction): Action {
  const type = KIND_TO_ACTION_TYPE[w.kind as keyof typeof KIND_TO_ACTION_TYPE];
  if (!type) throw new Error(`invalid wire action kind: ${w.kind}`);
  if (type === "pass") return { type: "pass" };
  return { type, cards: w.cards.map(wireToCard) };
}
