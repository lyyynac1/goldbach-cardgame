// lastClearedField(場を流した要因の手の残像表示用)の検証。
// 3枚とも互いに素な組でリードすると場が流れる(isTripleCoprimeReset)ことを利用し、
// 意図的に「場が流れる」状況を作って lastClearedField が正しく配信されること、
// そして次の(場を流していない)状態配信では null に戻ることを確認する。
import WebSocket from "ws";

let failures = 0;
function check(label, cond) {
  console.log(`${cond ? "PASS" : "FAIL"}: ${label}`);
  if (!cond) failures++;
}

class QueuedSocket {
  constructor(ws) {
    this.ws = ws;
    this.queue = [];
    this.waiters = [];
    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString());
      const waiter = this.waiters.shift();
      if (waiter) waiter(msg);
      else this.queue.push(msg);
    });
  }
  next(timeoutMs = 15000) {
    if (this.queue.length > 0) return Promise.resolve(this.queue.shift());
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("timeout")), timeoutMs);
      this.waiters.push((msg) => {
        clearTimeout(t);
        resolve(msg);
      });
    });
  }
  async nextOfType(type, timeoutMs = 15000) {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const msg = await this.next(timeoutMs);
      if (msg.type === type) return msg;
    }
  }
  send(obj) {
    this.ws.send(JSON.stringify(obj));
  }
}

function connect(code) {
  return new Promise((resolve, reject) => {
    const raw = new WebSocket(`ws://localhost:8787/room/${code}`);
    raw.on("error", reject);
    const qs = new QueuedSocket(raw);
    qs.nextOfType("welcome").then((welcome) => resolve({ raw, qs, welcome }));
  });
}

function gcd(a, b) {
  return b === 0 ? a : gcd(b, a % b);
}
function pairwiseCoprime(ranks) {
  for (let i = 0; i < ranks.length; i++) {
    for (let j = i + 1; j < ranks.length; j++) {
      if (gcd(ranks[i], ranks[j]) !== 1) return false;
    }
  }
  return true;
}

// 3枚とも互いに素、かつ合計23以下の組を手札から探す(見つかれば確実に場を流せる)
function pickTripleCoprimeLead(hand) {
  for (let i = 0; i < hand.length; i++) {
    for (let j = i + 1; j < hand.length; j++) {
      for (let k = j + 1; k < hand.length; k++) {
        const cards = [hand[i], hand[j], hand[k]];
        const ranks = cards.map((c) => c.r);
        if (ranks[0] + ranks[1] + ranks[2] <= 23 && pairwiseCoprime(ranks)) return cards;
      }
    }
  }
  return null;
}
function pickAnyLead(hand) {
  for (let i = 0; i < hand.length; i++) {
    for (let j = i + 1; j < hand.length; j++) {
      if (hand[i].r + hand[j].r <= 23) return [hand[i], hand[j]];
    }
  }
  for (let i = 0; i < hand.length; i++) {
    for (let j = i + 1; j < hand.length; j++) {
      for (let k = j + 1; k < hand.length; k++) {
        if (hand[i].r + hand[j].r + hand[k].r <= 23) return [hand[i], hand[j], hand[k]];
      }
    }
  }
  return null;
}

const createRes = await fetch("http://localhost:8787/room", { method: "POST" });
const { code } = await createRes.json();

const seat0 = await connect(code);
seat0.qs.send({ type: "startRequest" });
let stateMsg = await seat0.qs.nextOfType("state");

let sawClearedField = false;
let clearedFieldContent = null;
let sawNullAfterClear = false;
let turns = 0;
const MAX_TURNS = 60;

while (!stateMsg.view.finished && turns < MAX_TURNS && (!sawClearedField || !sawNullAfterClear)) {
  turns++;
  if (stateMsg.view.currentSeat === 0) {
    if (stateMsg.view.field.cards.length === 0) {
      const triple = pickTripleCoprimeLead(stateMsg.view.selfHand);
      const lead = triple ?? pickAnyLead(stateMsg.view.selfHand);
      seat0.qs.send({ type: "action", action: { kind: 0, cards: lead ?? [] } });
    } else {
      seat0.qs.send({ type: "action", action: { kind: 3, cards: [] } });
    }
  }
  stateMsg = await seat0.qs.nextOfType("state");

  if (stateMsg.view.lastClearedField !== null) {
    if (!sawClearedField) {
      sawClearedField = true;
      clearedFieldContent = stateMsg.view.lastClearedField;
      console.log("lastClearedFieldを検出:", clearedFieldContent, "(直前の行動者:", stateMsg.view.lastAction, ")");
    }
  } else if (sawClearedField && !sawNullAfterClear) {
    sawNullAfterClear = true;
    console.log("その次の配信ではnullに戻ることを確認");
  }
}

check("場が流れた際、lastClearedFieldに値が入る", sawClearedField);
check(
  "lastClearedFieldの中身が空でない(カードが入っている)",
  Array.isArray(clearedFieldContent) && clearedFieldContent.length > 0
);
check("場が流れた直後以外の配信では、lastClearedFieldはnullに戻る", sawNullAfterClear);

seat0.raw.close();

console.log(`\n${failures === 0 ? "すべてPASS" : `${failures}件FAIL`}`);
process.exit(failures === 0 ? 0 : 1);
