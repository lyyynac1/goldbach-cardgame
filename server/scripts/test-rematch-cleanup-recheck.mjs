// 機能1補足: 対局後に誰かが抜けて「必要な同意数」が変化した場合、cleanup側でも
// 再戦判定が再チェックされることの検証。
// seat0,1,2(人間3人)+seat3(bot)で対局。seat1,2が同意した状態でseat0(未投票)が
// 切断すると、必要人数が[1,2]に減り、既に両方同意済みなので即座に再戦が始まるはず。
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
  next(timeoutMs = 20000) {
    if (this.queue.length > 0) return Promise.resolve(this.queue.shift());
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("timeout")), timeoutMs);
      this.waiters.push((msg) => {
        clearTimeout(t);
        resolve(msg);
      });
    });
  }
  async nextOfType(type, timeoutMs = 20000) {
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

function pickLeadCards(hand) {
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

async function driveUntilFinished(player, mySocketSeat) {
  let view;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const msg = await player.qs.nextOfType("state");
    view = msg.view;
    if (view.finished) return view;
    if (view.currentSeat === mySocketSeat) {
      if (view.field.cards.length === 0) {
        const lead = pickLeadCards(view.selfHand);
        player.qs.send({ type: "action", action: { kind: 0, cards: lead ?? [] } });
      } else {
        player.qs.send({ type: "action", action: { kind: 3, cards: [] } });
      }
    }
  }
}

const createRes = await fetch("http://localhost:8787/room", { method: "POST" });
const { code } = await createRes.json();

const seat0 = await connect(code);
const seat1 = await connect(code);
const seat2 = await connect(code);
seat0.qs.send({ type: "startRequest" });

const [view0] = await Promise.all([
  driveUntilFinished(seat0, 0),
  driveUntilFinished(seat1, 1),
  driveUntilFinished(seat2, 2),
]);
check("対局が最後まで進んで終了する", view0.finished === true);

// seat1, seat2が同意(seat0はまだ)
seat1.qs.send({ type: "rematchVote" });
await seat1.qs.nextOfType("rematchStatus");
seat2.qs.send({ type: "rematchVote" });
const status = await seat1.qs.nextOfType("rematchStatus");
check(
  "seat1,2同意時点でrequiredSeatsは[0,1,2](seat0はまだ接続中)",
  JSON.stringify(status.requiredSeats) === JSON.stringify([0, 1, 2])
);
check("agreedSeatsは[1,2]", JSON.stringify(status.agreedSeats) === JSON.stringify([1, 2]));

// 未投票のseat0が切断 → 必要人数が[1,2]に変化 → 既に両方同意済みなので即座に再戦開始
seat0.raw.close();

const rematchState = await seat1.qs.nextOfType("state", 5000);
check(
  "seat0退室により必要人数が揃い、自動的に再戦が始まる(finished=false)",
  rematchState.view.finished === false
);

seat1.raw.close();
seat2.raw.close();

console.log(`\n${failures === 0 ? "すべてPASS" : `${failures}件FAIL`}`);
process.exit(failures === 0 ? 0 : 1);
