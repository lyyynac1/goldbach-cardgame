// bot着手前の待機(BOT_THINK_DELAY_MS=3000ms、クライアント側useGameSessionに合わせた値)
// が実際に効いているかの検証。人間(seat0)が最初の1手を出した直後、連続するbotの手
// それぞれの間隔が3000ms前後になっている(かつ0msの一括処理になっていない)ことを確認する。
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
  next(timeoutMs = 15000) {
    if (this.queue.length > 0) return Promise.resolve(this.queue.shift());
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("timeout")), timeoutMs);
      this.waiters.push((v) => {
        clearTimeout(t);
        resolve(v);
      });
    });
  }
  async nextOfType(type, timeoutMs = 15000) {
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

// seat0がリード番であれば1手出し、以後は完全にbot(seat1-3)だけが連続で手番を回す状況を作る
if (initial.currentSeat === 0) {
  const lead = pickLeadCards(initial.selfHand);
  seat0.qs.send({ type: "action", action: { kind: 0, cards: lead } });
} else {
  console.log("(seat0がリード番でなかったため、この検証はスキップ)");
  seat0.raw.close();
  process.exit(0);
}

// 以後、seat0からのactionは送らず(pass等もしない)、botの手番だけが連続するのを観察する。
// botの応答を3手ぶん観測して、間隔を計測する。
const timestamps = [];
for (let i = 0; i < 3; i++) {
  const { arrivedAt } = await seat0.qs.nextOfType("state");
  timestamps.push(arrivedAt);
}

const intervals = [];
for (let i = 1; i < timestamps.length; i++) {
  intervals.push(timestamps[i] - timestamps[i - 1]);
}

console.log("観測した手ごとの間隔(ms):", intervals);

check(
  "各stateの間隔がおおむね3000ms前後(2500ms以上)で、一括処理(0ms連発)になっていない",
  intervals.every((ms) => ms >= 2500)
);

seat0.raw.close();

console.log(`\n${failures === 0 ? "すべてPASS" : `${failures}件FAIL`}`);
process.exit(failures === 0 ? 0 : 1);
