// ユーザーが挙げた具体例「場が A・9・K(3枚出し)で、beatもdivisorも成立せず
// パスしか選べない」状況を、getLegalActionsに直接与えて検証する。
// (ランダムな手札配布に依存するため wrangler dev 上の実プレイでは狙って
// 再現しにくいので、エンジン単体に対する決定論的なテストとして書く)
//
// 場: A(1) 9 K(13) の3枚。テーブル(合計)=23、スコア(最大)=13、lastPlayCount=3。
// - beatが成立しないことの根拠: テーブル23のままスコアが13を超える組は作れない
//   (最大ランクが13なので、どんな2-3枚の組でも最大値は13が上限)
// - divisorが成立しないことの根拠: 場の公約数はGCD(1,9,13)=1。
//   「dをc.rankで割り切れる」= c.rank が 1 の約数、つまり c.rank===1 のカードのみが対象。
//   手札にrank=1のカードが無ければ、直前枚数-1=2枚の候補が集まらず不成立。
declare const process: { exit(code?: number): void };

import { GameState, Card } from "../../src/engine/types";
import { getLegalActions } from "../../src/engine/rules";

let failures = 0;
function check(label: string, cond: boolean) {
  console.log(`${cond ? "PASS" : "FAIL"}: ${label}`);
  if (!cond) failures++;
}

function card(suit: Card["suit"], rank: number): Card {
  return { suit, rank };
}

// 場: A(1) 9 K(13)。プレイヤー0の手番、手札にrank=1のカードは含めない。
const state: GameState = {
  players: [
    {
      id: 0,
      name: "p0",
      isBot: false,
      passed: false,
      // rank=1を含まない手札。5,6,7,8,10,11,12(A,9,Kは場に出ているので除く)から適当に。
      hand: [card("heart", 5), card("heart", 6), card("diamond", 7), card("club", 8), card("spade", 10)],
    },
    { id: 1, name: "p1", isBot: true, passed: false, hand: [] },
    { id: 2, name: "p2", isBot: true, passed: false, hand: [] },
    { id: 3, name: "p3", isBot: true, passed: false, hand: [] },
  ],
  turnOrder: [0, 1, 2, 3],
  field: {
    cards: [card("spade", 1), card("spade", 9), card("spade", 13)],
    table: 23,
    score: 13,
    lastPlayCount: 3,
  },
  currentPlayerId: 0,
  finished: false,
  winnerId: null,
  consecutiveLeadFailures: 0,
  pendingAgari: null,
  lastClearedField: [],
  log: [],
};

const legal = getLegalActions(state, 0);
console.log("legal actions:", JSON.stringify(legal));

check("合法手はpassただ1つだけ", legal.length === 1 && legal[0].type === "pass");

// 参考: rank=1のカードを1枚追加しても、divisorには2枚(lastPlayCount-1)必要なので
// まだ不成立のままであることも確認しておく(1枚では足りない)。
const stateWithOneAce: GameState = {
  ...state,
  players: state.players.map((p) =>
    p.id === 0 ? { ...p, hand: [...p.hand, card("diamond", 1)] } : p
  ),
};
const legalWithOneAce = getLegalActions(stateWithOneAce, 0);
check(
  "rank=1のカードが1枚だけ増えても、2枚必要なdivisorはまだ成立せずpassのみ",
  legalWithOneAce.length === 1 && legalWithOneAce[0].type === "pass"
);

// 対照実験: rank=1のカードが2枚あれば、今度こそdivisorが成立するはず(このテストの前提が
// 正しいことの裏取り)。
const stateWithTwoAces: GameState = {
  ...state,
  players: state.players.map((p) =>
    p.id === 0 ? { ...p, hand: [...p.hand, card("diamond", 1), card("heart", 1)] } : p
  ),
};
const legalWithTwoAces = getLegalActions(stateWithTwoAces, 0);
check(
  "(対照実験)rank=1のカードが2枚あればdivisorが成立し、passだけではなくなる",
  legalWithTwoAces.some((a) => a.type === "divisor")
);

console.log(`\n${failures === 0 ? "すべてPASS" : `${failures}件FAIL`}`);
process.exit(failures === 0 ? 0 : 1);
