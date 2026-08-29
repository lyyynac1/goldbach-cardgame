/**
 * 計測専用モジュール。
 *
 * src/engine/bot.ts の "hard" 難易度の内部ロジック(maxN探索)は、
 * 探索深度(HARD_DEPTH=6)が定数でハードコードされていて外から変更できない。
 * 深度を変えた場合の実行時間を計測するためだけに、同じアルゴリズムを
 * ここに複製し、深度だけ引数で変えられるようにしたもの。
 *
 * 本番の src/engine/bot.ts は一切変更していない。
 * ここでのロジックはあくまで計測用の複製であり、本番コードとして使わないこと。
 * (アルゴリズムは 2026-08 時点の src/engine/bot.ts の "hard" 分岐と同一のものを複製)
 */
import { Action, Card, GameState } from "../../src/engine/types";
import { getLegalActions, isTripleCoprimeReset } from "../../src/engine/rules";
import { countNonCoprimeRanks, sum } from "../../src/engine/mathUtils";
import { applyAction, computeScores, forceSkipLead, resolveAgariDiscard } from "../../src/engine/engine";

const FLEXIBLE_RANKS = new Set([1, 2, 3, 4, 6]);

function handRanks(hand: Card[]): number[] {
  return hand.map((c) => c.rank);
}

function removeCards(hand: Card[], toRemove: Card[]): Card[] {
  const remaining = [...hand];
  for (const c of toRemove) {
    const idx = remaining.findIndex((h) => h.suit === c.suit && h.rank === c.rank);
    remaining.splice(idx, 1);
  }
  return remaining;
}

function evaluateHandQuality(hand: Card[]): number {
  if (hand.length === 0) return 10_000;
  let score = 0;
  if (hand.length === 1) score -= 300;
  const ranks = handRanks(hand);
  score += ranks.filter((r) => FLEXIBLE_RANKS.has(r)).length * 8;
  score -= sum(ranks) * 0.4;
  return score;
}

function winBonusRankAware(action: Exclude<Action, { type: "pass" }>, rank: number): number {
  const willResetField = action.type === "divisor" || isTripleCoprimeReset(action);
  const table = sum(action.cards.map((c) => c.rank));
  const survivors = countNonCoprimeRanks(table);
  const baseSurvival = 10_000 + survivors * 8;
  if (willResetField) return rank === 1 ? 10_000 + 250 : 10_000 + 150;
  return baseSurvival;
}

function estimateRank(state: GameState, playerId: number): number {
  const mySize = state.players.find((p) => p.id === playerId)!.hand.length;
  let rank = 1;
  for (const p of state.players) {
    if (p.id !== playerId && p.hand.length < mySize) rank++;
  }
  return rank;
}

function scoreActionMedium(hand: Card[], action: Action): number {
  if (action.type === "pass") return -1_000_000;
  const handAfter = removeCards(hand, action.cards);
  if (handAfter.length === 0) {
    const willResetField = action.type === "divisor" || isTripleCoprimeReset(action);
    if (willResetField) return 10_000 + 150;
    const table = sum(action.cards.map((c) => c.rank));
    const survivors = countNonCoprimeRanks(table);
    return 10_000 + survivors * 8;
  }
  let score = evaluateHandQuality(handAfter);
  score += action.cards.length * 15;
  if (isTripleCoprimeReset(action)) score += 40;
  if (action.type === "divisor") score += 10;
  return score;
}

type ValueMap = Record<number, number>;
const TERMINAL_WIN_OFFSET = 10_000 + 150;

function terminalValues(state: GameState): ValueMap {
  const scores = computeScores(state);
  const values: ValueMap = {};
  for (const p of state.players) {
    if (state.winnerId === p.id) values[p.id] = TERMINAL_WIN_OFFSET + scores[p.id];
    else if (state.winnerId === null) values[p.id] = scores[p.id];
    else values[p.id] = -TERMINAL_WIN_OFFSET + scores[p.id];
  }
  return values;
}

function leafValues(state: GameState): ValueMap {
  const values: ValueMap = {};
  for (const p of state.players) values[p.id] = evaluateHandQuality(p.hand);
  return values;
}

function maxN(state: GameState, depth: number, branch: number): ValueMap {
  if (state.finished) return terminalValues(state);
  if (state.pendingAgari) return maxN(resolveAgariDiscard(state), depth, branch);
  if (depth <= 0) return leafValues(state);

  const mover = state.currentPlayerId;
  const player = state.players.find((p) => p.id === mover)!;
  const legal = getLegalActions(state, mover);
  if (legal.length === 0) return maxN(forceSkipLead(state), depth - 1, branch);

  const ranked = legal
    .map((a) => ({ action: a, score: scoreActionMedium(player.hand, a) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, branch);

  let best: ValueMap | null = null;
  let bestForMover = -Infinity;
  for (const { action } of ranked) {
    const child = applyAction(state, mover, action).state;
    const childValues = maxN(child, depth - 1, branch);
    if (childValues[mover] > bestForMover) {
      bestForMover = childValues[mover];
      best = childValues;
    }
  }
  return best!;
}

const HARD_ROOT_BRANCH = 10;
const HARD_BRANCH = 3;
const HARD_PASS_OPPORTUNITY_COST = 25;

/** src/engine/bot.ts の "hard" 分岐と同一ロジック。depth だけ外から指定できる計測用版。 */
export function chooseActionHardWithDepth(state: GameState, playerId: number, depth: number): Action | null {
  const legal = getLegalActions(state, playerId);
  if (legal.length === 0) return null;
  const player = state.players.find((p) => p.id === playerId)!;
  const rank = estimateRank(state, playerId);
  const nonPassLegal = legal.filter((a) => a.type !== "pass");

  const candidates = nonPassLegal
    .map((a) => ({ action: a, score: scoreActionMedium(player.hand, a) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, HARD_ROOT_BRANCH);

  let best: Action | null = null;
  let bestScore = -Infinity;
  for (const { action } of candidates) {
    let s: number;
    try {
      const handAfter = removeCards(player.hand, action.cards);
      if (handAfter.length === 0) {
        s = winBonusRankAware(action as Exclude<Action, { type: "pass" }>, rank);
      } else {
        const child = applyAction(state, playerId, action).state;
        s = maxN(child, depth - 1, HARD_BRANCH)[playerId];
      }
    } catch {
      s = scoreActionMedium(player.hand, action);
    }
    if (s > bestScore) {
      bestScore = s;
      best = action;
    }
  }

  const canPass = legal.some((a) => a.type === "pass");
  if (canPass) {
    let passScore: number;
    try {
      const passChild = applyAction(state, playerId, { type: "pass" }).state;
      passScore = maxN(passChild, depth - 1, HARD_BRANCH)[playerId] - HARD_PASS_OPPORTUNITY_COST;
    } catch {
      passScore = evaluateHandQuality(player.hand) - HARD_PASS_OPPORTUNITY_COST;
    }
    if (best === null || passScore > bestScore) return { type: "pass" };
  }

  return best;
}
