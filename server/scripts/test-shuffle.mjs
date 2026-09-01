// 機能2: プレイ順シャッフルの検証。対局開始のたびに先手(currentSeat)がランダムに
// 決まる(常にホストのseat0固定にならない)ことを、複数回の対局開始で確認する。
import WebSocket from "ws";

let failures = 0;
function check(label, cond) {
  console.log(`${cond ? "PASS" : "FAIL"}: ${label}`);
  if (!cond) failures++;
}

async function createAndStart() {
  const res = await fetch("http://localhost:8787/room", { method: "POST" });
  const { code } = await res.json();
  const { ws, view } = await new Promise((resolve, reject) => {
    const raw = new WebSocket(`ws://localhost:8787/room/${code}`);
    raw.on("error", reject);
    let welcomed = false;
    raw.on("message", (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === "welcome" && !welcomed) {
        welcomed = true;
        raw.send(JSON.stringify({ type: "startRequest" }));
        return;
      }
      if (msg.type === "state") {
        resolve({ ws: raw, view: msg.view });
      }
    });
  });
  return { ws, view };
}

const TRIALS = 24;
const startingSeats = new Set();

for (let i = 0; i < TRIALS; i++) {
  const { ws, view } = await createAndStart();
  startingSeats.add(view.currentSeat);
  // selfSeatは常にhost=0のはず(ソケット座席自体はシャッフルされない)
  check(`試行${i}: selfSeatは常に0(ソケット座席自体は変わらない)`, view.selfSeat === 0);
  ws.close();
}

console.log("観測した先手(currentSeat)の分布:", Array.from(startingSeats).sort());

check(
  `${TRIALS}回の試行で、先手が2種類以上観測される(常に0固定になっていない)`,
  startingSeats.size >= 2
);

console.log(`\n${failures === 0 ? "すべてPASS" : `${failures}件FAIL`}`);
process.exit(failures === 0 ? 0 : 1);
