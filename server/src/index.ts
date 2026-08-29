import { GameRoom } from "./GameRoom";
import { chooseAction, Difficulty } from "../../src/engine/bot";
import { initGame } from "../../src/engine/engine";
import { chooseActionHardWithDepth } from "../scripts/hard-bot-bench-core";

export { GameRoom };

export interface Env {
  GAME_ROOM: DurableObjectNamespace;
}

// ブラウザから直接叩かれるプレーンHTTPエンドポイント(POST /room など)向けのCORS許可オリジン。
// 開発中のクライアント(expo web, localhost:8081)を許可する。
// WebSocket(/room/<code>)自体はCORSの対象外(ブラウザがpreflightを要求しない)なので対象外でよい。
const ALLOWED_ORIGINS = new Set(["http://localhost:8081"]);

function corsHeaders(origin: string | null): HeadersInit {
  if (!origin || !ALLOWED_ORIGINS.has(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };
}

/** プレーンHTTPレスポンスにCORSヘッダーを付け足す(WebSocketアップグレード応答には使わないこと)。 */
function withCors(response: Response, origin: string | null): Response {
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(corsHeaders(origin))) headers.set(k, v);
  return new Response(response.body, { status: response.status, headers });
}

// 招待コードのアルファベット。紛らわしい文字(0/O, 1/I/L)を除外した英数字。
// 大文字のみに統一する(手入力での大小混同を無くすため、/room/<code>側で受信時に大文字化して比較する)。
const INVITE_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const INVITE_CODE_LENGTH = 8;
const INVITE_CODE_PATTERN = new RegExp(`^[${INVITE_CODE_ALPHABET}]{${INVITE_CODE_LENGTH}}$`);

/**
 * crypto.getRandomValues による招待コード生成。
 * 単純な `randomByte % alphabet.length` は alphabet.length が256の約数でない場合に
 * わずかな偏り(modulo bias)が出るため、範囲外のバイトを捨てる棄却法で完全に均一にする。
 */
function generateInviteCode(): string {
  const n = INVITE_CODE_ALPHABET.length; // 31
  const limit = 256 - (256 % n); // 256 % 31 = 8 → limit = 248。248以上のバイトは捨てる
  const buf = new Uint8Array(1);
  let code = "";
  while (code.length < INVITE_CODE_LENGTH) {
    crypto.getRandomValues(buf);
    if (buf[0] < limit) {
      code += INVITE_CODE_ALPHABET[buf[0] % n];
    }
  }
  return code;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");

    // ブラウザからのpreflightリクエスト(CORS)
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    // POST /room — 部屋を新規作成し、生成した招待コードを返す。
    // 招待コードはサーバー側でのみ生成する(クライアントが任意の文字列で部屋を作ることはできない)。
    if (url.pathname === "/room" && request.method === "POST") {
      const code = generateInviteCode();
      const id = env.GAME_ROOM.idFromName(code);
      const stub = env.GAME_ROOM.get(id);
      // このDOインスタンスを「作成済み」として記録する(/room/<code>側の存在確認で使う)
      const createResponse = await stub.fetch(new Request("https://internal/__create", { method: "POST" }));
      if (!createResponse.ok) {
        return withCors(new Response("failed to create room", { status: 500 }), origin);
      }
      return withCors(
        new Response(JSON.stringify({ code }), {
          status: 201,
          headers: { "content-type": "application/json" },
        }),
        origin
      );
    }

    // /room/<inviteCode> — 対戦部屋へのWebSocket接続。
    // 作成済み(POST /roomを経由した)の部屋にしか接続できない(GameRoom側で存在確認する)。
    // WebSocketのハンドシェイク自体はCORS(preflight)の対象外なのでCORSヘッダーは付与しない。
    const roomMatch = url.pathname.match(/^\/room\/([^/]+)$/);
    if (roomMatch) {
      const inviteCode = roomMatch[1].toUpperCase();
      if (!INVITE_CODE_PATTERN.test(inviteCode)) {
        return new Response("invalid invite code format", { status: 400 });
      }
      const id = env.GAME_ROOM.idFromName(inviteCode);
      const stub = env.GAME_ROOM.get(id);
      return stub.fetch(request);
    }

    // /bench — 上級bot(maxN探索)の実行時間計測用ルート(タスク3)。ゲームロジックへの
    // 本接続ではなく、Workers実行環境上での純粋な計測のためだけの一時的なルート。
    if (url.pathname === "/bench") {
      return withCors(handleBench(url), origin);
    }

    return withCors(new Response("goldbach-server: not found", { status: 404 }), origin);
  },
};

function handleBench(url: URL): Response {
  const playerCount = 4;
  const trials = Number(url.searchParams.get("trials") ?? "5");
  const difficulty = (url.searchParams.get("difficulty") ?? "hard") as Difficulty;
  const depthParam = url.searchParams.get("depth");

  const results: number[] = [];
  for (let i = 0; i < trials; i++) {
    const state = initGame(
      Array.from({ length: playerCount }, (_, i) => ({ name: `p${i}`, isBot: i !== 0 })),
      0
    );
    const start = performance.now();
    if (difficulty === "hard" && depthParam) {
      chooseActionHardWithDepth(state, 0, Number(depthParam));
    } else {
      chooseAction(state, 0, difficulty);
    }
    const elapsed = performance.now() - start;
    results.push(elapsed);
  }

  const avg = results.reduce((a, b) => a + b, 0) / results.length;
  const max = Math.max(...results);
  const min = Math.min(...results);

  return new Response(
    JSON.stringify(
      { difficulty, depth: depthParam ? Number(depthParam) : "default(6)", trials, results_ms: results, avg_ms: avg, min_ms: min, max_ms: max },
      null,
      2
    ),
    { headers: { "content-type": "application/json" } }
  );
}
