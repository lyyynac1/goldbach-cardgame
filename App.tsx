import React, { useCallback, useEffect, useState } from "react";
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
import { PlayerConfig } from "./src/state/useGameSession";
import { useTrophyEngine } from "./src/trophies/useTrophyEngine";
import { Difficulty } from "./src/engine/bot";

SplashScreen.preventAutoHideAsync().catch(() => {});

type Screen =
  | { name: "home" }
  | { name: "online-menu" }
  | { name: "online-lobby" }
  | { name: "online-join" }
  | { name: "online-game" }
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
  useEffect(() => {
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
  }, [room.status, screen.name]);

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
    if (!room.gameView) {
      return null;
    }
    return (
      <OnlineGameScreen
        view={room.gameView}
        onAction={room.sendAction}
        onExit={() => {
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
