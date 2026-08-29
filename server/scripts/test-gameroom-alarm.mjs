// Alarm APIによる無通信部屋の自動破棄を、短縮タイマー(?testIdleMs=)で検証する。
// 本番の既定値(30分)はGameRoom.ts側のDEFAULT_ROOM_IDLE_MSのまま変更していない。
import WebSocket from "ws";

let failures = 0;
function check(label, cond) {
  console.log(`${cond ? "PASS" : "FAIL"}: ${label}`);
  if (!cond) failures++;
}

const code = "ALARMTEST01";
const idleMs = 1500; // テストなので1.5秒に短縮

const ws = await new Promise((resolve, reject) => {
  const w = new WebSocket(`ws://localhost:8787/room/${code}?testIdleMs=${idleMs}`);
  w.on("open", () => {});
  w.on("error", reject);
  w.once("message", () => resolve(w)); // welcomeを待つ
});

console.log(`接続完了。${idleMs}ms 何も送らず放置します...`);

const result = await new Promise((resolve) => {
  ws.once("message", (data) => resolve({ kind: "message", payload: JSON.parse(data.toString()) }));
  ws.once("close", (code) => resolve({ kind: "close", code }));
  setTimeout(() => resolve({ kind: "timeout" }), idleMs + 3000);
});

console.log("結果:", result);

check(
  "idle時間経過後、roomClosedメッセージを受信する",
  result.kind === "message" && result.payload.type === "roomClosed"
);

const closeResult = await new Promise((resolve) => {
  if (ws.readyState === ws.CLOSED) return resolve(true);
  ws.once("close", () => resolve(true));
  setTimeout(() => resolve(false), 2000);
});
check("roomClosed後、実際に接続もcloseされる", closeResult === true);

console.log(`\n${failures === 0 ? "すべてPASS" : `${failures}件FAIL`}`);
process.exit(failures === 0 ? 0 : 1);
