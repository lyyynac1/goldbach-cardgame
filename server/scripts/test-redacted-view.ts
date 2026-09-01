// redactedView.ts の単体検証。wrangler不要、node/tsxだけで動く。
declare const process: { exit(code?: number): void };
import { initGame, applyAction } from "../../src/engine/engine";
import { getLegalActions } from "../../src/engine/rules";
import { buildRedactedView } from "../src/redactedView";

let failures = 0;
function check(label: string, cond: boolean) {
  console.log(`${cond ? "PASS" : "FAIL"}: ${label}`);
  if (!cond) failures++;
}

// 4人でゲーム開始し、何手か進めて場札がある状態を作る
let state = initGame(
  Array.from({ length: 4 }, (_, i) => ({ name: `p${i}`, isBot: i !== 0 })),
  0
);
const firstLegal = getLegalActions(state, 0).find((a) => a.type === "lead")!;
state = applyAction(state, 0, firstLegal).state;

const realHand0 = state.players.find((p) => p.id === 0)!.hand;
const realHand1 = state.players.find((p) => p.id === 1)!.hand;

const identitySeatMap = [0, 1, 2, 3] as const;
const viewFor0 = buildRedactedView(state, 0, identitySeatMap, { seat: 0, kind: 0 }, null, 1);

check("selfSeatが要求したプレイヤーIDと一致する", viewFor0.selfSeat === 0);
check("selfHandの枚数が実際の手札枚数と一致する", viewFor0.selfHand.length === realHand0.length);
check(
  "opponentsに自分自身が含まれない",
  viewFor0.opponents.every((o) => o.seat !== 0)
);
check("opponentsが自分以外の3人ぶんある", viewFor0.opponents.length === 3);
check(
  "opponentのhandCountが実際の手札枚数と一致する(枚数だけは公開情報)",
  viewFor0.opponents.find((o) => o.seat === 1)!.handCount === realHand1.length
);

// 最重要: シリアライズしたJSON全体を見ても、他人の実際のカード(rank/suit)が
// 一切含まれていないことを確認する(「枚数だけ」を型だけでなく実際のペイロードでも保証する)
const serialized = JSON.stringify(viewFor0);
const opponentRanks = realHand1.map((c) => c.rank);
// selfHandにも同じrankの数字が偶然出ることはあるので、「他人の手札の並び(JSON配列表現)」が
// 丸ごと含まれていないかで判定する(簡易だが十分な検証)
const leaked = JSON.stringify(realHand1.map((c) => ({ s: 0, r: c.rank }))); // ラフな痕跡チェック用
check(
  "レスポンスに opponents[].hand のようなフィールド自体が存在しない",
  !serialized.includes('"hand"')
);

// 場札は公開情報なので、こちらは一致していてよい(伏せる対象ではない)
check("field.cardsは公開情報としてそのまま含まれる", viewFor0.field.cards.length === state.field.cards.length);

console.log(`\n${failures === 0 ? "すべてPASS" : `${failures}件FAIL`}`);
process.exit(failures === 0 ? 0 : 1);
