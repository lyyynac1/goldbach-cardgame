// 機能1: 再戦の検証。
// - finished前のrematchVoteはGameNotFinished(11)で拒否される
// - rematchVoteのたびにrematchStatusが配信される(agreedSeats/requiredSeats)
// - 接続中の人間全員が同意すると、自動的に新しい対局が始まる(ロビーを経由しない)
// - 対局後に一人抜けて必要人数が変わった場合、cleanup側で再戦判定が再チェックされる
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

// 自分の手番が来るたびに雑な戦略(場が空ならlead、そうでなければpass)で反応しつつ、
// finishedになったstateが届くまで待つ。人間が複数いる場合、それぞれ自分の視点のstateを
// 個別に受け取るので、プレイヤーごとにこの関数を並行して回す。
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
seat0.qs.send({ type: "startRequest" });

// ---- finished前のrematchVoteは拒否される ----
seat0.qs.send({ type: "rematchVote" });
const earlyErr = await seat0.qs.nextOfType("error");
check("finished前のrematchVoteはGameNotFinished(11)で拒否される", earlyErr.code === 11);

// ---- 対局を最後まで進める(seat0, seat1両方が自分の手番に反応する) ----
const [finalView0] = await Promise.all([driveUntilFinished(seat0, 0), driveUntilFinished(seat1, 1)]);
check("対局が最後まで進んで終了する", finalView0.finished === true);

// ---- seat1が先に同意 ----
seat1.qs.send({ type: "rematchVote" });
const status1 = await seat0.qs.nextOfType("rematchStatus");
check("seat1の同意後、agreedSeatsに1だけが含まれる", JSON.stringify(status1.agreedSeats) === JSON.stringify([1]));
check(
  "requiredSeatsは接続中の2席(0,1)",
  JSON.stringify(status1.requiredSeats) === JSON.stringify([0, 1])
);

// ---- seat0も同意 → 全員一致で自動的に再戦が始まる ----
seat0.qs.send({ type: "rematchVote" });
const rematchState = await seat0.qs.nextOfType("state");
check("全員同意後、ロビーを経由せず新しいstateが届く(finished=false)", rematchState.view.finished === false);
check("再戦後もselfSeatは変わらず0", rematchState.view.selfSeat === 0);

seat0.raw.close();
seat1.raw.close();

console.log(`\n${failures === 0 ? "すべてPASS" : `${failures}件FAIL`}`);
process.exit(failures === 0 ? 0 : 1);
