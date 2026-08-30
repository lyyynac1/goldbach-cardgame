import { Card, Suit } from "../engine/types";

// サーバー側 protocol.ts の WIRE_SUITS と同じ並び順であること。
// ここがずれるとスペードがハートとして表示されるので、変更する場合は必ず両方を揃える。
const WIRE_SUITS: Suit[] = ["spade", "heart", "diamond", "club"];

export type WireCard = { s: number; r: number };

/** サーバー側の行動種別。protocol.ts の ActionKind と同じ値。 */
export const WireActionKind = {
  Lead: 0,
  Beat: 1,
  Divisor: 2,
  Pass: 3,
} as const;

export type WireAction = {
  kind: number;
  cards: WireCard[];
};

export function wireToCard(w: WireCard): Card {
  return { suit: WIRE_SUITS[w.s], rank: w.r };
}

export function cardToWire(c: Card): WireCard {
  return { s: WIRE_SUITS.indexOf(c.suit), r: c.rank };
}

export function wireToCards(list: WireCard[]): Card[] {
  return list.map(wireToCard);
}

export function cardsToWire(list: Card[]): WireCard[] {
  return list.map(cardToWire);
}
