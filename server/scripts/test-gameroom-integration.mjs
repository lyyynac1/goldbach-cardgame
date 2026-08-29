// GameRoom(本実装)の統合テスト: 座席割当・座席再利用・ping/pong・不正メッセージでの切断・満席拒否。
import WebSocket from "ws";

let failures = 0;
function check(label, cond) {
  console.log(`${cond ? "PASS" : "FAIL"}: ${label}`);
  if (!cond) failures++;
}

function connect(code) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:8787/room/${code}`);
    ws.on("error", reject);
    ws.once("message", (data) => resolve({ ws, welcome: JSON.parse(data.toString()) }));
  });
}

function once(ws) {
  return new Promise((resolve) => ws.once("message", (data) => resolve(JSON.parse(data.toString()))));
}

function withTimeout(promise, ms, label) {
  return Promise.race([promise, new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout: ${label}`)), ms))]);
}

const code = "INTEGTEST02";

// ---- 座席割当: 順に接続した3人が座席0,1,2を受け取る ----
const a = await connect(code);
const b = await connect(code);
const c = await connect(code);
check("Aがseat 0を受け取る", a.welcome.type === "welcome" && a.welcome.seat === 0);
check("Bがseat 1を受け取る", b.welcome.type === "welcome" && b.welcome.seat === 1);
check("Cがseat 2を受け取る", c.welcome.type === "welcome" && c.welcome.seat === 2);

// ---- ping/pong ----
a.ws.send(JSON.stringify({ type: "ping", nonce: 7 }));
const pong = await withTimeout(once(a.ws), 2000, "pong");
check("pingを送るとpongが返る(同じnonce)", pong.type === "pong" && pong.nonce === 7);

// ---- 不正メッセージは形式チェックで拒否され、切断される(Cで検証。Cの座席2は空く) ----
const closePromise = new Promise((resolve) => c.ws.once("close", (code2) => resolve(code2)));
const errorMsgPromise = once(c.ws);
c.ws.send(JSON.stringify({ type: "chat", text: "自由入力のチャットのつもり(拒否されるべき)" }));
const errorMsg = await withTimeout(errorMsgPromise, 2000, "error message");
check("不正な形式のメッセージにerrorが返る", errorMsg.type === "error" && typeof errorMsg.code === "number");
const closeCode = await withTimeout(closePromise, 2000, "close");
check("不正メッセージ送信後、接続が切断される", closeCode === 1008);

// ---- 座席の再利用: Cが抜けた後の新規接続は、空いた座席2を再利用する ----
const d = await connect(code);
check("Cが抜けた後の新規接続は空いた座席2を再利用する", d.welcome.seat === 2);

// ---- 満席: A,B,D + 新たにEで4席すべて埋め、5人目は403で拒否される ----
const e = await connect(code);
check("Eがseat 3を受け取る(これで満席)", e.welcome.seat === 3);

const fifthRejected = await new Promise((resolve) => {
  const ws = new WebSocket(`ws://localhost:8787/room/${code}`);
  ws.on("unexpected-response", (_req, res) => resolve(res.statusCode));
  ws.on("open", () => resolve("connected(satisfied - BUG)"));
  ws.on("error", () => resolve("error(no status code)"));
  setTimeout(() => resolve("timeout"), 2000);
});
check("満席の部屋への5人目の接続は403で拒否される", fifthRejected === 403);

for (const s of [a, b, d, e]) s.ws.close();

console.log(`\n${failures === 0 ? "すべてPASS" : `${failures}件FAIL`}`);
process.exit(failures === 0 ? 0 : 1);
