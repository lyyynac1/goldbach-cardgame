import { useCallback, useEffect, useRef, useState } from "react";
import { WireAction, WireCard } from "./wireCard";

// 接続先は環境変数で切り替える。未設定時はローカルの wrangler dev に接続する。
// 本番URLは .env.production に EXPO_PUBLIC_SERVER_ORIGIN として記述する。
const SERVER_ORIGIN =
  process.env.EXPO_PUBLIC_SERVER_ORIGIN ?? "http://localhost:8787";

export type SeatStatus = { seat: number; occupied: boolean };

export type OpponentView = {
  seat: number;
  handCount: number;
  passed: boolean;
  isBot: boolean;
};

export type FieldView = {
  cards: WireCard[];
  score: number | null;
  table: number | null;
  lastPlayCount: number;
};

export type LastActionView = {
  seat: number;
  kind: number;
};

export type GameView = {
  selfSeat: number;
  selfHand: WireCard[];
  opponents: OpponentView[];
  field: FieldView;
  currentSeat: number;
  finished: boolean;
  winnerSeat: number | null;
  lastAction: LastActionView | null;
  pendingAgariSeat: number | null;
  lastClearedField: WireCard[] | null;
  seq: number;
};

export type RematchStatus = {
  agreedSeats: number[];
  requiredSeats: number[];
};

export type RoomStatus =
  | "idle"
  | "creating"
  | "connecting"
  | "waiting"
  | "playing"
  | "closed"
  | "error";

export type OnlineRoom = {
  status: RoomStatus;
  inviteCode: string | null;
  mySeat: number | null;
  connectedCount: number;
  seats: SeatStatus[];
  gameView: GameView | null;
  turnDeadline: number | null;
  errorMessage: string | null;
  rematchStatus: RematchStatus | null;
  createRoom: () => Promise<void>;
  joinRoom: (code: string) => void;
  start: () => void;
  sendAction: (action: WireAction) => void;
  voteRematch: () => void;
  leave: () => void;
};

export function useOnlineRoom(): OnlineRoom {
  const [status, setStatus] = useState<RoomStatus>("idle");
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [mySeat, setMySeat] = useState<number | null>(null);
  const [connectedCount, setConnectedCount] = useState(0);
  const [seats, setSeats] = useState<SeatStatus[]>([]);
  const [gameView, setGameView] = useState<GameView | null>(null);
  const [turnDeadline, setTurnDeadline] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [rematchStatus, setRematchStatus] = useState<RematchStatus | null>(
    null,
  );

  const wsRef = useRef<WebSocket | null>(null);

  const closeSocket = useCallback(() => {
    const ws = wsRef.current;
    if (ws) {
      // 意図的に閉じる場合、onclose等が後から発火して
      // リセット済みの状態を上書きしないようハンドラを外してから閉じる
      ws.onopen = null;
      ws.onmessage = null;
      ws.onerror = null;
      ws.onclose = null;
      ws.close();
      wsRef.current = null;
    }
  }, []);

  // アンマウント時に必ず切断する
  useEffect(() => closeSocket, [closeSocket]);

  const connect = useCallback(
    (code: string) => {
      closeSocket();
      setStatus("connecting");
      setErrorMessage(null);

      const wsUrl = SERVER_ORIGIN.replace(/^http/, "ws") + `/room/${code}`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setInviteCode(code);
        setStatus("waiting");
      };

      ws.onmessage = (event) => {
        let msg: any;
        try {
          msg = JSON.parse(event.data);
        } catch {
          return;
        }

        switch (msg.type) {
          case "welcome":
            setMySeat(msg.seat);
            break;
          case "seatUpdate":
            setSeats(msg.seats ?? []);
            setConnectedCount(msg.connectedCount ?? 0);
            break;
          case "state":
            console.log("state", msg.view);
            setGameView(msg.view);
            setStatus("playing");
            if (msg.view.finished === false) {
              setRematchStatus(null);
            }
            break;
          case "rematchStatus":
            setRematchStatus({
              agreedSeats: msg.agreedSeats ?? [],
              requiredSeats: msg.requiredSeats ?? [],
            });
            break;
          case "turnDeadline":
            setTurnDeadline(msg.deadlineAt);
            break;
          case "roomClosed":
            setStatus("closed");
            break;
          case "error":
            setErrorMessage(`エラーが発生しました (${msg.code})`);
            break;
        }
      };

      // 申請書の制約8: 接続できない場合もエラー状態で止まらないようにする
      ws.onerror = () => {
        setStatus("error");
        setErrorMessage("サーバーに接続できませんでした");
      };

      ws.onclose = () => {
        wsRef.current = null;
        setStatus((prev) =>
          prev === "closed" || prev === "error" ? prev : "closed",
        );
      };
    },
    [closeSocket],
  );

  const createRoom = useCallback(async () => {
    setStatus("creating");
    setErrorMessage(null);
    try {
      const res = await fetch(`${SERVER_ORIGIN}/room`, { method: "POST" });
      if (!res.ok) {
        throw new Error("failed");
      }
      const body = await res.json();
      connect(body.code);
    } catch {
      setStatus("error");
      setErrorMessage("部屋を作成できませんでした");
    }
  }, [connect]);

  const joinRoom = useCallback(
    (code: string) => {
      connect(code);
    },
    [connect],
  );

  const start = useCallback(() => {
    wsRef.current?.send(JSON.stringify({ type: "startRequest" }));
  }, []);

  const sendAction = useCallback((action: WireAction) => {
    wsRef.current?.send(JSON.stringify({ type: "action", action }));
  }, []);

  const voteRematch = useCallback(() => {
    wsRef.current?.send(JSON.stringify({ type: "rematchVote" }));
  }, []);

  const leave = useCallback(() => {
    closeSocket();
    setStatus("idle");
    setInviteCode(null);
    setMySeat(null);
    setConnectedCount(0);
    setSeats([]);
    setGameView(null);
    setTurnDeadline(null);
    setErrorMessage(null);
    setRematchStatus(null);
  }, [closeSocket]);

  return {
    status,
    inviteCode,
    mySeat,
    connectedCount,
    seats,
    gameView,
    turnDeadline,
    errorMessage,
    rematchStatus,
    createRoom,
    joinRoom,
    start,
    sendAction,
    voteRematch,
    leave,
  };
}
