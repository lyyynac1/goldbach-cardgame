/**
 * サーバーが持つ完全情報の GameState から、特定プレイヤー視点の
 * 「自分の手札は実データ、他人は枚数のみ」なビューを生成する。
 *
 * 場札(field.cards)は全員に公開されている情報なのでそのまま含める。
 * 手札を伏せる対象はあくまで各プレイヤーの hand のみ。
 */
import { Card, GameState } from "../../src/engine/types";
import { FieldView, LastActionView, OpponentSeatView, RedactedGameStateView, SeatId, WireCard } from "./protocol";
import { cardToWire } from "./wireConvert";

export function buildRedactedView(
  state: GameState,
  forPlayerId: number,
  lastAction: LastActionView | null,
  lastClearedField: Card[] | null
): RedactedGameStateView {
  const self = state.players.find((p) => p.id === forPlayerId);
  if (!self) {
    throw new Error(`buildRedactedView: player ${forPlayerId} not found in state`);
  }

  const opponents: OpponentSeatView[] = state.players
    .filter((p) => p.id !== forPlayerId)
    .sort((a, b) => a.id - b.id)
    .map((p) => ({
      seat: p.id as SeatId,
      isBot: p.isBot,
      handCount: p.hand.length,
      passed: p.passed,
    }));

  const field: FieldView = {
    cards: state.field.cards.map(cardToWire),
    table: state.field.table,
    score: state.field.score,
    lastPlayCount: state.field.lastPlayCount,
  };

  return {
    selfSeat: forPlayerId as SeatId,
    selfHand: self.hand.map(cardToWire),
    opponents,
    field,
    currentSeat: state.currentPlayerId as SeatId,
    finished: state.finished,
    winnerSeat: state.winnerId as SeatId | null,
    pendingAgariSeat: state.pendingAgari ? (state.pendingAgari.playerId as SeatId) : null,
    lastAction,
    lastClearedField: lastClearedField ? lastClearedField.map(cardToWire) : null,
  };
}
