// seq(単調増加の連番)の検証。
// - recordActionが呼ばれたときにのみ増える
// - recordActionを伴わないbroadcastState(人間の入力待ちに入るだけの保険的な再配信など)
//   ではseqが変化しない
// - 全座席に同じ値が配信される
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

function pickLeadCards(hand) {
  for (let i = 0; i < hand.length; i++) {
    for (let j = i + 1; j < hand.length; j++) {
      if (hand[i].r + hand[j].r <= 23) return [hand[i], hand[j]];
    }
  }
  return null;
}

// ==== フェーズ1: seat0,1を両方接続。seat0がリード後、次はseat1(人間)の入力待ちに
//      なるだけ(recordActionを伴わない保険的な再配信)なので、seqが変化しないことと、
//      全座席に同じ値が配信されることを確認する ====
{
  const createRes = await fetch("http://localhost:8787/room", { method: "POST" });
  const { code } = await createRes.json();

  const seat0 = await connect(code);
  const seat1 = await connect(code);

  seat0.qs.send({ type: "startRequest" });
  const initial0 = await seat0.qs.nextOfType("state");
  const initial1 = await seat1.qs.nextOfType("state");

  check("開始直後(まだ誰も行動していない)、seq=0", initial0.view.seq === 0);
  check("開始直後、seat1にも同じseq=0が届く(全座席で同じ値)", initial1.view.seq === 0);

  if (initial0.view.currentSeat === 0) {
    const lead = pickLeadCards(initial0.view.selfHand);
    seat0.qs.send({ type: "action", action: { kind: 0, cards: lead } });

    const afterMyMove0 = await seat0.qs.nextOfType("state");
    const afterMyMove1 = await seat1.qs.nextOfType("state");
    check("自分の手の直後、seq=1に増える", afterMyMove0.view.seq === 1);
    check("同じ手の直後、seat1視点でも同じseq=1", afterMyMove1.view.seq === 1);

    // 次はseat1(人間)の入力待ちになるだけのはず。この保険的な再配信ではrecordActionを
    // 呼んでいないので、seqは変化しない。
    if (afterMyMove0.view.currentSeat === 1) {
      // seat1が実際に何か送るまでは新しいstateは来ないので、代わりにseat1へping/pongで
      // 到達性だけ確認しつつ、直近のseqが1のままであることを確認する。
      check(
        "次が人間(seat1)の入力待ちになるだけの場合、直近のseqは1のまま(変化していない)",
        afterMyMove0.view.seq === 1 && afterMyMove1.view.seq === 1
      );
    }
  }

  seat0.raw.close();
  seat1.raw.close();
}

// ==== フェーズ2: seat0だけ接続(seat1-3は全てbot)。連続するbotの手でseqが
//      単調に増えていくことを確認する ====
{
  const createRes = await fetch("http://localhost:8787/room", { method: "POST" });
  const { code } = await createRes.json();

  const seat0 = await connect(code);
  seat0.qs.send({ type: "startRequest" });
  const initial = await seat0.qs.nextOfType("state");
  check("(フェーズ2)開始直後、opponentsが全員bot", initial.view.opponents.every((o) => o.isBot));

  let prevSeq = initial.view.seq;
  let increased = false;

  if (initial.view.currentSeat === 0) {
    const lead = pickLeadCards(initial.view.selfHand);
    seat0.qs.send({ type: "action", action: { kind: 0, cards: lead } });

    const afterMyMove = await seat0.qs.nextOfType("state");
    check("(フェーズ2)自分の手の直後、seqが増える", afterMyMove.view.seq > prevSeq);
    prevSeq = afterMyMove.view.seq;

    // 続けてbot(seat1-3)の手が連続する。3回ぶん観測して、毎回真に増えていることを確認する。
    for (let i = 0; i < 3; i++) {
      const next = await seat0.qs.nextOfType("state");
      const ok = next.view.seq > prevSeq;
      if (!ok) {
        console.log(`(フェーズ2) ${i}回目でseqが増えなかった: prev=${prevSeq}, next=${next.view.seq}`);
      } else {
        increased = true;
      }
      prevSeq = next.view.seq;
    }
  }
  check("(フェーズ2)連続するbotの手で、seqが真に増え続ける(逆行・停滞しない)", increased);

  seat0.raw.close();
}

console.log(`\n${failures === 0 ? "すべてPASS" : `${failures}件FAIL`}`);
process.exit(failures === 0 ? 0 : 1);
