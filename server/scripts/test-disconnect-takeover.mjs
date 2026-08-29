// 対局中の人間切断→即座にbot化、全員切断→即座に部屋破棄、の検証。
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
      const t = setTimeout(() => reject(new Error("message timeout")), timeoutMs);
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

function tryConnectPlain(code) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://localhost:8787/room/${code}`);
    ws.on("open", () => resolve({ ok: true, ws }));
    ws.on("unexpected-response", (_req, res) => resolve({ ok: false, status: res.statusCode }));
    setTimeout(() => resolve({ ok: false, status: "timeout" }), 3000);
  });
}

async function createRoom() {
  const res = await fetch("http://localhost:8787/room", { method: "POST" });
  const body = await res.json();
  return body.code;
}

// ==== ケース1: 対局中にseat1(人間)が切断 → 即座にbot化して進行が止まらない ====
{
  const code = await createRoom();
  const seat0 = await connect(code);
  const seat1 = await connect(code);
  seat0.qs.send({ type: "startRequest" });
  const initial = await seat0.qs.nextOfType("state");

  check(
    "開始直後、seat1は(人間として接続中なので)isBot=false",
    initial.view.opponents.find((o) => o.seat === 1).isBot === false
  );

  // seat1を切断する
  seat1.raw.close();

  // seat0に、seat1がbot化された(isBot=trueになった)stateが届くはず
  // (advanceAndBroadcastが呼ばれて再配信されるため、直後のstateで確認できる)
  const afterDisconnect = await seat0.qs.nextOfType("state");
  check(
    "seat1切断後、opponents[].isBotがtrueに更新される",
    afterDisconnect.view.opponents.find((o) => o.seat === 1).isBot === true
  );

  seat0.raw.close();
}

// ==== ケース2: 全員切断すると即座に部屋が破棄される(Alarmの30分を待たない) ====
{
  const code = await createRoom();
  const seat0 = await connect(code);
  seat0.raw.close();

  await new Promise((r) => setTimeout(r, 500)); // close処理の完了を待つ

  const reconnect = await tryConnectPlain(code);
  check("全員切断後、即座に部屋が破棄され再接続できない(404)", reconnect.ok === false && reconnect.status === 404);
}

// ==== ケース3: 対局中に全員(人間)が切断すると、bot同士でも継続せず即座に破棄される ====
{
  const code = await createRoom();
  const seat0 = await connect(code);
  const seat1 = await connect(code);
  seat0.qs.send({ type: "startRequest" });
  await seat0.qs.nextOfType("state");

  seat0.raw.close();
  seat1.raw.close();

  await new Promise((r) => setTimeout(r, 500));

  const reconnect = await tryConnectPlain(code);
  check(
    "対局中に全員切断しても、bot同士で継続せず即座に破棄される",
    reconnect.ok === false && reconnect.status === 404
  );
}

console.log(`\n${failures === 0 ? "すべてPASS" : `${failures}件FAIL`}`);
process.exit(failures === 0 ? 0 : 1);
