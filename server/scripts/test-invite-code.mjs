// 招待コードのサーバー生成・存在確認(要件1,3,4)の検証。
import WebSocket from "ws";

let failures = 0;
function check(label, cond) {
  console.log(`${cond ? "PASS" : "FAIL"}: ${label}`);
  if (!cond) failures++;
}

async function createRoom() {
  const res = await fetch("http://localhost:8787/room", { method: "POST" });
  const body = await res.json();
  return { status: res.status, code: body.code };
}

function tryConnect(code) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://localhost:8787/room/${code}`);
    ws.on("open", () => resolve({ ok: true, ws }));
    ws.on("unexpected-response", (_req, res) => resolve({ ok: false, status: res.statusCode }));
    ws.on("error", () => resolve({ ok: false, status: "error" }));
    setTimeout(() => resolve({ ok: false, status: "timeout" }), 3000);
  });
}

const CODE_PATTERN = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$/;

// ---- POST /room が正しい形式のコードを生成する ----
const room1 = await createRoom();
check("POST /roomが201を返す", room1.status === 201);
check("生成されたコードが8文字・許容文字種のみ", CODE_PATTERN.test(room1.code));

// ---- 紛らわしい文字(0/O,1/I/L)が含まれない ----
check("コードに紛らわしい文字(0,O,1,I,L)が含まれない", !/[01OIL]/.test(room1.code));

// ---- 複数回生成すると別のコードになる(衝突しない) ----
const room2 = await createRoom();
check("2回連続で生成しても別のコードになる", room1.code !== room2.code);

// ---- 作成済みのコードには接続できる ----
const connectOk = await tryConnect(room1.code);
check("作成済みのコードにはWebSocket接続できる", connectOk.ok === true);
if (connectOk.ok) connectOk.ws.close();

// ---- クライアントが作成していない、形式は正しいがランダムなコードは拒否される(404) ----
const randomUncreatedCode = "ZZZZZZZZ"; // 形式は正しいが作成された記録が無いコード
const connectRandom = await tryConnect(randomUncreatedCode);
check(
  "未作成の(形式は正しい)コードへの接続は404で拒否される",
  connectRandom.ok === false && connectRandom.status === 404
);

// ---- 形式が不正なコードは400で拒否される ----
const connectMalformed = await tryConnect("short");
check("形式が不正なコード(短い・小文字含む)は400で拒否される", connectMalformed.ok === false && connectMalformed.status === 400);

// ---- 紛らわしい文字を含むコードも形式不正として拒否される ----
const connectConfusing = await tryConnect("O0O0O0O0"); // 8文字だがアルファベットに含まれない文字
check("紛らわしい文字を含むコードは400で拒否される", connectConfusing.ok === false && connectConfusing.status === 400);

console.log(`\n${failures === 0 ? "すべてPASS" : `${failures}件FAIL`}`);
process.exit(failures === 0 ? 0 : 1);
