import { GameRoom } from "./GameRoom";
import { chooseAction, Difficulty } from "../../src/engine/bot";
import { initGame } from "../../src/engine/engine";
import { chooseActionHardWithDepth } from "../scripts/hard-bot-bench-core";

export { GameRoom };

export interface Env {
  GAME_ROOM: DurableObjectNamespace;
}

// 招待コード(=DOのID)として許容する形式。暫定: 英数字6〜12文字。
// (規定の文字数・文字種以外は受け付けない、という申請書の制約2をここで担保する)
const INVITE_CODE_PATTERN = /^[A-Za-z0-9]{6,12}$/;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // /room/<inviteCode> — PoC: DOへのWebSocketエコー確認用ルート
    const roomMatch = url.pathname.match(/^\/room\/([^/]+)$/);
    if (roomMatch) {
      const inviteCode = roomMatch[1];
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
      return handleBench(url);
    }

    return new Response("goldbach-server: not found", { status: 404 });
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
