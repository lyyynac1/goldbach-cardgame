/**
 * サーバーが持つ完全情報の GameState から、特定プレイヤー視点の
 * 「自分の手札は実データ、他人は枚数のみ」なビューを生成する。
 *
 * 場札(field.cards)は全員に公開されている情報なのでそのまま含める。
 * 手札を伏せる対象はあくまで各プレイヤーの hand のみ。
 *
 * 座席番号について: GameState内の全ての識別子(currentPlayerId, winnerId,
 * pendingAgari.playerId, players[].id)は「エンジンのプレイヤーID」であり、
 * 対局開始のたびにシャッフルされる(seatToPlayerId)。一方クライアントは自分自身を
 * 「ソケットの座席番号」(welcomeで受け取ったもの)で認識しているため、
 * ここで全てソケット座席番号に変換してから返す。
 */
import { Card, GameState } from "../../src/engine/types";
import { FieldView, LastActionView, OpponentSeatView, RedactedGameStateView, SeatId, WireCard } from "./protocol";
import { cardToWire } from "./wireConvert";

function playerIdToSeat(seatToPlayerId: readonly SeatId[], playerId: number): SeatId {
  return seatToPlayerId.indexOf(playerId as SeatId) as SeatId;
}

export function buildRedactedView(
  state: GameState,
  forSocketSeat: SeatId,
  seatToPlayerId: readonly SeatId[],
  lastAction: LastActionView | null,
  lastClearedField: Card[] | null,
  seq: number
): RedactedGameStateView {
  const forPlayerId = seatToPlayerId[forSocketSeat];
  const self = state.players.find((p) => p.id === forPlayerId);
  if (!self) {
    throw new Error(
      `buildRedactedView: player ${forPlayerId} (socket seat ${forSocketSeat}) not found in state`
    );
  }

  const opponents: OpponentSeatView[] = state.players
    .filter((p) => p.id !== forPlayerId)
    .map((p) => ({
      seat: playerIdToSeat(seatToPlayerId, p.id),
      isBot: p.isBot,
      handCount: p.hand.length,
      passed: p.passed,
    }))
    .sort((a, b) => a.seat - b.seat);

  const field: FieldView = {
    cards: state.field.cards.map(cardToWire),
    table: state.field.table,
    score: state.field.score,
    lastPlayCount: state.field.lastPlayCount,
  };

  return {
    selfSeat: forSocketSeat,
    selfHand: self.hand.map(cardToWire),
    opponents,
    field,
    currentSeat: playerIdToSeat(seatToPlayerId, state.currentPlayerId),
    finished: state.finished,
    winnerSeat: state.winnerId !== null ? playerIdToSeat(seatToPlayerId, state.winnerId) : null,
    pendingAgariSeat: state.pendingAgari ? playerIdToSeat(seatToPlayerId, state.pendingAgari.playerId) : null,
    lastAction: lastAction
      ? { seat: playerIdToSeat(seatToPlayerId, lastAction.seat), kind: lastAction.kind }
      : null,
    lastClearedField: lastClearedField ? lastClearedField.map(cardToWire) : null,
    seq,
  };
}
