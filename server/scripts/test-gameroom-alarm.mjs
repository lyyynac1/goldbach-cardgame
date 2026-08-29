// Alarm APIによる無通信部屋の自動破棄を、短縮タイマー(?testIdleMs=)で検証する。
// 本番の既定値(30分)はGameRoom.ts側のDEFAULT_ROOM_IDLE_MSのまま変更していない。
import WebSocket from "ws";

let failures = 0;
function check(label, cond) {
  console.log(`${cond ? "PASS" : "FAIL"}: ${label}`);
  if (!cond) failures++;
}

const createRes = await fetch("http://localhost:8787/room", { method: "POST" });
const { code } = await createRes.json();
const idleMs = 1500; // テストなので1.5秒に短縮

const ws = new WebSocket(`ws://localhost:8787/room/${code}?testIdleMs=${idleMs}`);
await new Promise((resolve, reject) => {
  ws.on("open", resolve);
  ws.on("error", reject);
});

console.log(`接続完了。${idleMs}ms 何も送らず放置します...`);

const result = await new Promise((resolve) => {
  ws.on("message", (data) => {
    const payload = JSON.parse(data.toString());
    if (payload.type === "roomClosed") resolve({ kind: "message", payload });
    // welcome / seatUpdate 等はここでは無視して roomClosed だけを待つ
  });
  ws.once("close", (code) => resolve({ kind: "close", code }));
  setTimeout(() => resolve({ kind: "timeout" }), idleMs + 4000);
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
