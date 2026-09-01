import React, { useCallback, useEffect, useRef, useState } from "react";
import { StatusBar } from "expo-status-bar";
import * as SplashScreen from "expo-splash-screen";
import { View } from "react-native";
// サブパス指定で必要なウェイトのみを読み込む(バレルからの読み込みだと全ウェイトが
// バンドルに含まれてしまい、Web書き出し時に不要なフォントで数十MB膨れ上がるため)
import { useFonts as useShipporiMincho } from "@expo-google-fonts/shippori-mincho/useFonts";
import { ShipporiMincho_500Medium } from "@expo-google-fonts/shippori-mincho/500Medium";
import { useFonts as useZenKakuGothicNew } from "@expo-google-fonts/zen-kaku-gothic-new/useFonts";
import { ZenKakuGothicNew_400Regular } from "@expo-google-fonts/zen-kaku-gothic-new/400Regular";
import { useFonts as useSpaceMono } from "@expo-google-fonts/space-mono/useFonts";
import { SpaceMono_400Regular } from "@expo-google-fonts/space-mono/400Regular";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ThemeProvider, useTheme } from "./src/ThemeContext";
import { HomeScreen } from "./src/screens/HomeScreen";
import { GameScreen } from "./src/screens/GameScreen";
import { OnlineMenuScreen } from "./src/screens/OnlineMenuScreen";
import { OnlineLobbyScreen } from "./src/screens/OnlineLobbyScreen";
import { OnlineJoinScreen } from "./src/screens/OnlineJoinScreen";
import { useOnlineRoom } from "./src/state/useOnlineRoom";
import { OnlineGameScreen } from "./src/screens/OnlineGameScreen";
import { OnlineResultScreen } from "./src/screens/OnlineResultScreen";
import { OnlineErrorScreen } from "./src/screens/OnlineErrorScreen";
import { PlayerConfig, HUMAN_PLAYER_ID } from "./src/state/useGameSession";
import { useTrophyEngine } from "./src/trophies/useTrophyEngine";
import { Difficulty } from "./src/engine/bot";

SplashScreen.preventAutoHideAsync().catch(() => {});

type Screen =
  | { name: "home" }
  | { name: "online-menu" }
  | { name: "online-lobby" }
  | { name: "online-join" }
  | { name: "online-game" }
  | { name: "online-failed" }
  | { name: "game"; players: PlayerConfig[] };

function Root() {
  const theme = useTheme();
  const [screen, setScreen] = useState<Screen>({ name: "home" });
  // アプリ全体でBot難度を保持する。ホーム→ゲーム→ホームの遷移でリセットされない
  const [botDifficulties, setBotDifficulties] = useState<Difficulty[]>([
    "easy",
    "medium",
    "hard",
  ]);
  // HomeScreenとGameScreenがそれぞれ別のuseTrophyEngineインスタンスを持つと、
  // 片方で獲得したトロフィーがもう片方の画面(特にメニュー)に反映されないため、
  // ここで1つだけ生成して両方に渡すことで状態を確実に共有する。
  const trophyEngine = useTrophyEngine();
  const room = useOnlineRoom();

  // 結果画面を出すまでの2秒遅延。finishedを検知した時点のgameViewを凍結して保持する。
  // サーバーは対戦終了後に部屋を即時破棄するため、遅延中にroom.gameViewがnullになったり
  // 接続がcloseしたりし得るが、その間も最終盤面を表示し続けるためにこの凍結が必要。
  const RESULT_REVEAL_DELAY_MS = 800;
  const [frozenView, setFrozenView] = useState<typeof room.gameView>(null);
  const [showResult, setShowResult] = useState(false);
  const [pendingResult, setPendingResult] = useState(false);
  const [clearedActive, setClearedActive] = useState(false);
  const [hasVotedRematch, setHasVotedRematch] = useState(false);
  const finishedHandledRef = useRef(false);
  const resultTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (room.gameView?.finished && !finishedHandledRef.current) {
      finishedHandledRef.current = true;
      setFrozenView(room.gameView);
      setPendingResult(true);
    }
  }, [room.gameView]);

  useEffect(() => {
    if (
      room.gameView &&
      !room.gameView.finished &&
      finishedHandledRef.current
    ) {
      finishedHandledRef.current = false;
      setShowResult(false);
      setFrozenView(null);
      setPendingResult(false);
      setClearedActive(false);
      setHasVotedRematch(false);
    }
  }, [room.gameView]);

  // 残像表示中は結果画面への切り替えを待つ。残像が消えた(clearedActiveがfalseになった)
  // 時点でタイマーを開始する。残像自体が出ていなければ即座に開始される。
  useEffect(() => {
    if (pendingResult && !clearedActive) {
      resultTimerRef.current = setTimeout(
        () => setShowResult(true),
        RESULT_REVEAL_DELAY_MS,
      );
      return () => {
        if (resultTimerRef.current) clearTimeout(resultTimerRef.current);
      };
    }
  }, [pendingResult, clearedActive]);

  // アンマウント時のみタイマーを掃除する。room.gameViewの変化のたびに
  // クリーンアップが走ると、finished後の追加配信(recordActionを伴わない
  // 保険的な再配信)でタイマーが誤ってキャンセルされてしまうため、
  // 依存配列を分離している。
  useEffect(() => {
    return () => {
      if (resultTimerRef.current) clearTimeout(resultTimerRef.current);
    };
  }, []);

  // 再戦や新規部屋でロビーに戻ったら状態をリセットする
  useEffect(() => {
    if (room.status === "waiting") {
      finishedHandledRef.current = false;
      setShowResult(false);
      setFrozenView(null);
      setPendingResult(false);
      setClearedActive(false);
      setHasVotedRematch(false);
    }
  }, [room.status]);

  useEffect(() => {
    if (room.status === "error" || room.status === "closed") {
      // 対戦が正常に終わった場合は結果画面を出すので、ここでは飛ばさない
      if (room.gameView?.finished || finishedHandledRef.current) return;
      if (screen.name.startsWith("online") && screen.name !== "online-failed") {
        setScreen({ name: "online-failed" });
      }
      return;
    }
    if (room.status === "playing") {
      if (screen.name !== "online-game") {
        setScreen({ name: "online-game" });
      }
      return;
    }
    if (room.status === "waiting") {
      if (screen.name !== "online-lobby") {
        setScreen({ name: "online-lobby" });
      }
    }
  }, [room.status, room.gameView?.finished, screen.name]);

  if (screen.name === "home") {
    return (
      <HomeScreen
        onStart={(players) => setScreen({ name: "game", players })}
        onOnline={() => setScreen({ name: "online-menu" })}
        trophyEngine={trophyEngine}
        botDifficulties={botDifficulties}
        onBotDifficultiesChange={setBotDifficulties}
      />
    );
  }
  if (screen.name === "online-menu") {
    return (
      <OnlineMenuScreen
        onCreateRoom={() => room.createRoom()}
        onJoinRoom={() => setScreen({ name: "online-join" })}
        onBack={() => setScreen({ name: "home" })}
      />
    );
  }
  if (screen.name === "online-lobby") {
    return (
      <OnlineLobbyScreen
        inviteCode={room.inviteCode}
        connectedCount={room.connectedCount}
        isHost={room.mySeat === 0}
        onStart={() => room.start()}
        onLeave={() => {
          room.leave();
          setScreen({ name: "online-menu" });
        }}
      />
    );
  }
  if (screen.name === "online-game") {
    const view = frozenView ?? room.gameView;
    if (!view) {
      return null;
    }
    if (showResult) {
      return (
        <OnlineResultScreen
          view={view}
          onBackToHome={() => {
            room.leave();
            setScreen({ name: "home" });
          }}
          onVoteRematch={() => {
            setHasVotedRematch(true);
            room.voteRematch();
          }}
          rematchStatus={room.rematchStatus}
          hasVotedRematch={hasVotedRematch}
        />
      );
    }
    return (
      <OnlineGameScreen
        view={view}
        turnDeadline={room.turnDeadline}
        onAction={room.sendAction}
        onClearedSnapshotActive={setClearedActive}
        onExit={() => {
          room.leave();
          setScreen({ name: "home" });
        }}
      />
    );
  }
  if (screen.name === "online-failed") {
    return (
      <OnlineErrorScreen
        reason={room.status === "error" ? "error" : "closed"}
        message={room.errorMessage}
        onSolo={() => {
          room.leave();
          setScreen({
            name: "game",
            players: [
              {
                id: HUMAN_PLAYER_ID,
                name: "あなた",
                isBot: false,
                difficulty: "easy",
              },
              ...botDifficulties.map((d, i) => ({
                id: i + 1,
                name: `b${i + 1}`,
                isBot: true,
                difficulty: d,
              })),
            ],
          });
        }}
        onBackToHome={() => {
          room.leave();
          setScreen({ name: "home" });
        }}
      />
    );
  }
  if (screen.name === "online-join") {
    return (
      <OnlineJoinScreen
        onJoin={(code) => room.joinRoom(code)}
        onBack={() => {
          room.leave();
          setScreen({ name: "online-menu" });
        }}
        errorMessage={room.errorMessage}
      />
    );
  }
  return (
    <GameScreen
      players={screen.players}
      onExit={() => setScreen({ name: "home" })}
      trophyEngine={trophyEngine}
    />
  );
}

export default function App() {
  const [f1] = useShipporiMincho({ ShipporiMincho_500Medium });
  const [f2] = useZenKakuGothicNew({ ZenKakuGothicNew_400Regular });
  const [f3] = useSpaceMono({ SpaceMono_400Regular });
  const fontsLoaded = f1 && f2 && f3;

  const onLayoutRootView = useCallback(async () => {
    if (fontsLoaded) {
      await SplashScreen.hideAsync().catch(() => {});
    }
  }, [fontsLoaded]);

  if (!fontsLoaded) {
    return null;
  }

  return (
    <View style={{ flex: 1 }} onLayout={onLayoutRootView}>
      <SafeAreaProvider>
        <ThemeProvider>
          <Root />
          <StatusBar style="auto" />
        </ThemeProvider>
      </SafeAreaProvider>
    </View>
  );
}
