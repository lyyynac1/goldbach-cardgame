// 2点の検証:
// 1. 人間がactionを送った直後、そのプレイヤー自身の手がbotの手と一緒くたにならず、
//    単独で先に配信されること(handleActionでのbroadcastState順序の修正)
// 2. state.lastAction に直前の行動者(seat)と種別(kind)が正しく入ること
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
      const arrivedAt = Date.now();
      const waiter = this.waiters.shift();
      if (waiter) waiter({ msg, arrivedAt });
      else this.queue.push({ msg, arrivedAt });
    });
  }
  next(timeoutMs = 10000) {
    if (this.queue.length > 0) return Promise.resolve(this.queue.shift());
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("timeout")), timeoutMs);
      this.waiters.push((v) => {
        clearTimeout(t);
        resolve(v);
      });
    });
  }
  async nextOfType(type, timeoutMs = 10000) {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const v = await this.next(timeoutMs);
      if (v.msg.type === type) return v;
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
    qs.nextOfType("welcome").then(({ msg }) => resolve({ raw, qs, welcome: msg }));
  });
}

function pickLeadCards(hand) {
  for (let i = 0; i < hand.length; i++) {
    for (let j = i + 1; j < hand.length; j++) {
      if (hand[i].r + hand[j].r <= 23) return [hand[i], hand[j]];
    }
  }
  return null;
}

const createRes = await fetch("http://localhost:8787/room", { method: "POST" });
const { code } = await createRes.json();

const seat0 = await connect(code);
seat0.qs.send({ type: "startRequest" });
const { msg: initialMsg } = await seat0.qs.nextOfType("state");
const initial = initialMsg.view;

check("ゲーム開始直後、lastActionはnull", initial.lastAction === null);

const lead = pickLeadCards(initial.selfHand);
const sentAt = Date.now();
seat0.qs.send({ type: "action", action: { kind: 0, cards: lead } });

// 1回目に届くstateは「自分の手だけが反映された」もののはず(botはまだ動いていない)
const { msg: firstMsg, arrivedAt: firstArrivedAt } = await seat0.qs.nextOfType("state");
check("actionを送った直後、最初に届くstateのlastActionは自分(seat0)", firstMsg.view.lastAction?.seat === 0);
check("最初に届くstateのlastAction.kindはlead(0)", firstMsg.view.lastAction?.kind === 0);
check(
  "最初に届くstateは、場のカードがちょうど自分が出した枚数(botはまだ動いていない)",
  firstMsg.view.field.cards.length === lead.length
);
check("最初のstateはbotの800ms待機より前、ほぼ即座に届く(300ms未満)", firstArrivedAt - sentAt < 300);

// 2回目に届くstateはbot(seat1)の手のはず。1回目からBOT_MOVE_DELAY_MS(800ms)前後空くはず
const { msg: secondMsg, arrivedAt: secondArrivedAt } = await seat0.qs.nextOfType("state");
check("2回目に届くstateのlastActionはbot(seat1)", secondMsg.view.lastAction?.seat === 1);
check(
  "1回目と2回目のstateの間隔が600ms以上空いている(一緒くたに配信されていない証拠)",
  secondArrivedAt - firstArrivedAt >= 600
);

console.log("lastAction遷移:", { first: firstMsg.view.lastAction, second: secondMsg.view.lastAction });
console.log("配信間隔(ms):", secondArrivedAt - firstArrivedAt);

seat0.raw.close();

console.log(`\n${failures === 0 ? "すべてPASS" : `${failures}件FAIL`}`);
process.exit(failures === 0 ? 0 : 1);
