// GameRoomへのゲームロジック接続の統合テスト。
// 1人の人間(seat 0) + bot3体(hard)で、実際に対戦が最初から最後まで進むことを確認する。
import WebSocket from "ws";

let failures = 0;
function check(label, cond) {
  console.log(`${cond ? "PASS" : "FAIL"}: ${label}`);
  if (!cond) failures++;
}

// 接続直後から全メッセージをキューイングしておき、取りこぼしを防ぐ小さなラッパー。
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
      const t = setTimeout(() => reject(new Error("message timeout")), timeoutMs);
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

// 場が空のときのlead候補として、自分の手札から適当な2枚(テーブル23以下)を選ぶだけの雑な戦略。
function pickLeadCards(hand) {
  for (let i = 0; i < hand.length; i++) {
    for (let j = i + 1; j < hand.length; j++) {
      if (hand[i].r + hand[j].r <= 23) return [hand[i], hand[j]];
    }
  }
  return null;
}

const code = `GP${Date.now().toString(36).slice(-8)}`;

// ---- 非ホストのstartRequestは拒否される ----
const seat0 = await connect(code);
const seat1 = await connect(code);
check("seat0がhost(seat0)", seat0.welcome.seat === 0);
check("seat1が着席", seat1.welcome.seat === 1);

seat1.qs.send({ type: "startRequest" });
const notHostErr = await seat1.qs.nextOfType("error");
check("非ホストのstartRequestはNotHost(8)で拒否される", notHostErr.code === 8);
seat1.raw.close();

// ---- ホストがstartRequest。空席3つはbotになり対戦開始 ----
seat0.qs.send({ type: "startRequest" });
const stateMsg0 = await seat0.qs.nextOfType("state");

check("開始後、selfSeatが0", stateMsg0.view.selfSeat === 0);
check("開始直後、selfHandが13枚", stateMsg0.view.selfHand.length === 13);
check(
  "seat1-3がbotとして扱われている",
  stateMsg0.view.opponents.every((o) => o.isBot === true) && stateMsg0.view.opponents.length === 3
);

let stateMsg = stateMsg0;

// ---- 不正な手は弾かれる(切断はされない) ----
if (stateMsg.view.currentSeat === 0) {
  seat0.qs.send({ type: "action", action: { kind: 0, cards: [{ s: 0, r: 13 }, { s: 1, r: 13 }] } }); // 13+13=26>23で違法
  const illegalErr = await seat0.qs.nextOfType("error");
  check("違法な手はIllegalAction(2)で拒否される", illegalErr.code === 2);
  check("違法な手を送っても接続は維持される", seat0.raw.readyState === seat0.raw.OPEN);
}

// ---- 実際にゲームを最後まで進める(自分の手番のたびに雑な戦略でaction送信) ----
let turns = 0;
const MAX_TURNS = 80;
while (!stateMsg.view.finished && turns < MAX_TURNS) {
  turns++;
  if (stateMsg.view.currentSeat === 0) {
    if (stateMsg.view.field.cards.length === 0) {
      // 場が空 = 自分がリード番。leadできる組み合わせを探す(無ければサーバー側が自動でforceSkipするはず)
      const lead = pickLeadCards(stateMsg.view.selfHand);
      seat0.qs.send({ type: "action", action: { kind: 0, cards: lead ?? [] } });
    } else {
      // 場がある = beat/divisor/pass。ここでは常にpass(常に合法)を選ぶ雑な戦略でよい
      seat0.qs.send({ type: "action", action: { kind: 3, cards: [] } });
    }
  }
  stateMsg = await seat0.qs.nextOfType("state");
}

check("MAX_TURNS以内にゲームが終了する", stateMsg.view.finished === true);
console.log(`(観測したstateメッセージ数: ${turns})`);
console.log("最終状態:", { finished: stateMsg.view.finished, winnerSeat: stateMsg.view.winnerSeat });

seat0.raw.close();

console.log(`\n${failures === 0 ? "すべてPASS" : `${failures}件FAIL`}`);
process.exit(failures === 0 ? 0 : 1);
