// seatUpdate メッセージ(ロビー用の座席の埋まり具合通知)の検証。
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
  next(timeoutMs = 5000) {
    if (this.queue.length > 0) return Promise.resolve(this.queue.shift());
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("timeout")), timeoutMs);
      this.waiters.push((msg) => {
        clearTimeout(t);
        resolve(msg);
      });
    });
  }
  async nextOfType(type, timeoutMs = 5000) {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const msg = await this.next(timeoutMs);
      if (msg.type === type) return msg;
    }
  }
}

function connect(code) {
  return new Promise((resolve, reject) => {
    const raw = new WebSocket(`ws://localhost:8787/room/${code}`);
    raw.on("error", reject);
    const qs = new QueuedSocket(raw);
    resolve({ raw, qs });
  });
}

const createRes = await fetch("http://localhost:8787/room", { method: "POST" });
const { code } = await createRes.json();

const seat0 = await connect(code);
const su1 = await seat0.qs.nextOfType("seatUpdate"); // seat0自身の入室分
check("1人目接続時、connectedCount=1", su1.connectedCount === 1);
check("1人目接続時、seat0だけoccupied", su1.seats.filter((s) => s.occupied).map((s) => s.seat).join(",") === "0");

const seat1 = await connect(code);
const su2 = await seat0.qs.nextOfType("seatUpdate"); // seat1入室に伴う通知(seat0視点)
check("2人目接続時、seat0にもconnectedCount=2が届く", su2.connectedCount === 2);
const su2FromSeat1 = await seat1.qs.nextOfType("seatUpdate"); // seat1自身にも同じ内容が届く
check("2人目接続時、seat1自身にもconnectedCount=2が届く", su2FromSeat1.connectedCount === 2);

seat1.raw.close();
const su3 = await seat0.qs.nextOfType("seatUpdate"); // seat1退室に伴う通知
check("2人目退室後、connectedCount=1に戻る", su3.connectedCount === 1);
check("2人目退室後、seat1がoccupied=falseになる", su3.seats.find((s) => s.seat === 1).occupied === false);

seat0.raw.close();

console.log(`\n${failures === 0 ? "すべてPASS" : `${failures}件FAIL`}`);
process.exit(failures === 0 ? 0 : 1);
