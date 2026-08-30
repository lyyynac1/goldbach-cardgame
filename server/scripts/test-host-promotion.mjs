// ロビー中(対戦開始前)にホスト(seat0)が抜けた場合、残っている最も若い席へ
// ホストが自動的に昇格することの検証。
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

const createRes = await fetch("http://localhost:8787/room", { method: "POST" });
const { code } = await createRes.json();

const seat0 = await connect(code);
const seat1 = await connect(code);

const su1 = await seat1.qs.nextOfType("seatUpdate"); // seat1自身の入室分
check("最初はhost=0", su1.host === 0);

// ホスト(seat0)がロビー中に退出する
seat0.raw.close();

const su2 = await seat1.qs.nextOfType("seatUpdate"); // seat0退室に伴う通知
check("seat0退室後、host=1に昇格する", su2.host === 1);

// 旧ホスト(seat0)が送るはずだったstartRequestを、新ホスト(seat1)が送って成功することを確認
seat1.qs.send({ type: "startRequest" });
const stateMsg = await seat1.qs.nextOfType("state", 5000);
check("昇格したホスト(seat1)のstartRequestで対戦が開始する", stateMsg.view.selfSeat === 1);

seat1.raw.close();

console.log(`\n${failures === 0 ? "すべてPASS" : `${failures}件FAIL`}`);
process.exit(failures === 0 ? 0 : 1);
