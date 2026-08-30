// 要件1(パスしか選べない場合の自動パス)と要件2(手番タイムアウト)の検証。
// 人間(seat0)を接続だけして一切actionを送らず、対局が最後まで自動的に進むことを確認する。
// - パスしか選べない手番は即座(HUMAN_AUTO_PASS_DELAY_MS)に自動処理される
// - 本当に選択が必要な手番は、タイムアウト(testTurnTimeoutMsで短縮)後に自動処理される
// どちらも機能していなければ、この対局は無期限に進行が止まる。
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
  next(timeoutMs = 10000) {
    if (this.queue.length > 0) return Promise.resolve(this.queue.shift());
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("timeout")), timeoutMs);
      this.waiters.push((msg) => {
        clearTimeout(t);
        resolve(msg);
      });
    });
  }
  async nextOfType(type, timeoutMs = 10000) {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const msg = await this.next(timeoutMs);
      if (msg.type === type) return msg;
    }
  }
}

function connect(code, extraQuery = "") {
  return new Promise((resolve, reject) => {
    const raw = new WebSocket(`ws://localhost:8787/room/${code}${extraQuery}`);
    raw.on("error", reject);
    const qs = new QueuedSocket(raw);
    qs.nextOfType("welcome").then((welcome) => resolve({ raw, qs, welcome }));
  });
}

const createRes = await fetch("http://localhost:8787/room", { method: "POST" });
const { code } = await createRes.json();

// 手番タイムアウトを1200msに短縮してテストを現実的な時間で終わらせる
const seat0 = await connect(code, "?testTurnTimeoutMs=1200");
seat0.raw.send(JSON.stringify({ type: "startRequest" }));

let sawTurnDeadline = false;
let finalState = null;
const deadline = Date.now() + 120000; // このテスト全体の上限(2分): 手番タイムアウトが複数回入っても十分な余裕

while (Date.now() < deadline) {
  const msg = await seat0.qs.next(15000);
  if (msg.type === "turnDeadline") {
    sawTurnDeadline = true;
    continue;
  }
  if (msg.type === "state") {
    finalState = msg.view;
    if (msg.view.finished) break;
    continue;
  }
}

check("一度もactionを送らなくても、turnDeadline(タイムアウト仕掛け)が観測される", sawTurnDeadline);
check("一度もactionを送らなくても、対局が最後まで進んで終了する", finalState?.finished === true);
console.log("最終状態:", finalState ? { finished: finalState.finished, winnerSeat: finalState.winnerSeat } : null);

seat0.raw.close();

console.log(`\n${failures === 0 ? "すべてPASS" : `${failures}件FAIL`}`);
process.exit(failures === 0 ? 0 : 1);
