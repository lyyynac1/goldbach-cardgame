import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTheme } from "../ThemeContext";
import { Difficulty } from "../engine/bot";
import {
  PlayerConfig,
  HUMAN_PLAYER_ID,
  GAMES_PER_SET,
} from "../state/useGameSession";
import { RulesModal } from "../components/RulesModal";
import { TrophyListModal } from "../components/TrophyListModal";
import { ColumnModal } from "../components/ColumnModal";
import { CreditsModal } from "../components/CreditsModal";
import { TrophyEngine } from "../trophies/useTrophyEngine";

const DIFFICULTIES: Difficulty[] = ["easy", "medium", "hard"];
const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  easy: "初級",
  medium: "中級",
  hard: "上級",
};

interface HomeScreenProps {
  onStart: (players: PlayerConfig[]) => void;
  onOnline: () => void;
  trophyEngine: TrophyEngine;
  botDifficulties: Difficulty[];
  onBotDifficultiesChange: (difficulties: Difficulty[]) => void;
}

export function HomeScreen({
  onStart,
  onOnline,
  trophyEngine,
  botDifficulties,
  onBotDifficultiesChange,
}: HomeScreenProps) {
  const theme = useTheme();
  const [rulesVisible, setRulesVisible] = React.useState(false);
  const [trophiesVisible, setTrophiesVisible] = React.useState(false);
  const [columnVisible, setColumnVisible] = React.useState(false);
  const [creditsVisible, setCreditsVisible] = React.useState(false);

  const cycleDifficulty = (index: number) => {
    const next = [...botDifficulties];
    const curIdx = DIFFICULTIES.indexOf(next[index]);
    next[index] = DIFFICULTIES[(curIdx + 1) % DIFFICULTIES.length];
    onBotDifficultiesChange(next);
  };

  const handleStart = () => {
    const players: PlayerConfig[] = [
      { id: HUMAN_PLAYER_ID, name: "あなた", isBot: false, difficulty: "easy" },
      ...botDifficulties.map((d, i) => ({
        id: i + 1,
        name: `b${i + 1}`,
        isBot: true,
        difficulty: d,
      })),
    ];
    onStart(players);
  };

  return (
    <View
      style={[styles.container, { backgroundColor: theme.colors.background }]}
    >
      <Text
        style={[
          styles.title,
          {
            color: theme.colors.textPrimary,
            fontFamily: theme.typography.display.fontFamily,
          },
        ]}
      >
        ゴールドバッハ
      </Text>
      <Text
        style={[
          styles.subtitle,
          {
            color: theme.colors.textSecondary,
            fontFamily: theme.typography.body.fontFamily,
          },
        ]}
      >
        {GAMES_PER_SET}ゲーム1セット・数論カードゲーム
      </Text>

      <View style={styles.botList}>
        {botDifficulties.map((d, i) => (
          <Pressable
            key={i}
            onPress={() => cycleDifficulty(i)}
            style={[styles.botRow, { borderColor: theme.colors.border }]}
          >
            <Text
              style={{
                color: theme.colors.textPrimary,
                fontFamily: theme.typography.body.fontFamily,
                fontSize: 23,
              }}
            >
              b{i + 1}
            </Text>
            <View
              style={[
                styles.difficultyPill,
                { backgroundColor: theme.colors.accentTeal },
              ]}
            >
              <Text
                style={{
                  color: "#FFFDF8",
                  fontFamily: theme.typography.body.fontFamily,
                  fontSize: 20,
                }}
              >
                {DIFFICULTY_LABEL[d]}
              </Text>
            </View>
          </Pressable>
        ))}
        <Text
          style={{
            color: theme.colors.textSecondary,
            fontFamily: theme.typography.body.fontFamily,
            fontSize: 18,
            marginTop: 6,
          }}
        >
          タップで強さを切り替え
        </Text>
      </View>

      <Pressable
        onPress={handleStart}
        style={[
          styles.startButton,
          {
            backgroundColor: theme.colors.accentGold,
            borderRadius: theme.radius.control,
          },
        ]}
      >
        <Text
          style={{
            color: theme.colors.onAccentGold,
            fontFamily: theme.typography.body.fontFamily,
            fontSize: 24,
          }}
        >
          ひとりで遊ぶ
        </Text>
      </Pressable>

      <Pressable
        onPress={onOnline}
        style={[
          styles.onlineButton,
          {
            borderColor: theme.colors.border,
            borderRadius: theme.radius.control,
          },
        ]}
      >
        <Text
          style={{
            color: theme.colors.textPrimary,
            fontFamily: theme.typography.body.fontFamily,
            fontSize: 24,
          }}
        >
          みんなで遊ぶ
        </Text>
      </Pressable>
      <View style={styles.linkRow}>
        <Pressable
          onPress={() => setRulesVisible(true)}
          style={styles.rulesLink}
          hitSlop={8}
        >
          <Text
            style={{
              color: theme.colors.textSecondary,
              fontFamily: theme.typography.body.fontFamily,
              fontSize: 20,
            }}
          >
            ルール
          </Text>
        </Pressable>
        <Pressable
          onPress={() => setTrophiesVisible(true)}
          style={styles.rulesLink}
          hitSlop={8}
        >
          <Text
            style={{
              color: theme.colors.textSecondary,
              fontFamily: theme.typography.body.fontFamily,
              fontSize: 20,
            }}
          >
            トロフィー
          </Text>
        </Pressable>
        <Pressable
          onPress={() => setColumnVisible(true)}
          style={styles.rulesLink}
          hitSlop={8}
        >
          <Text
            style={{
              color: theme.colors.textSecondary,
              fontFamily: theme.typography.body.fontFamily,
              fontSize: 20,
            }}
          >
            コラム
          </Text>
        </Pressable>
        <Pressable
          onPress={() => setCreditsVisible(true)}
          style={styles.rulesLink}
          hitSlop={8}
        >
          <Text
            style={{
              color: theme.colors.textSecondary,
              fontFamily: theme.typography.body.fontFamily,
              fontSize: 20,
            }}
          >
            クレジット
          </Text>
        </Pressable>
      </View>

      <RulesModal
        visible={rulesVisible}
        onClose={() => setRulesVisible(false)}
      />
      <TrophyListModal
        visible={trophiesVisible}
        onClose={() => setTrophiesVisible(false)}
        allTrophies={trophyEngine.allTrophies}
        unlockedIds={trophyEngine.unlockedIds}
        totalSetsPlayed={trophyEngine.totalSetsPlayed}
        totalSetsWon={trophyEngine.totalSetsWon}
        totalGamesWon={trophyEngine.totalGamesWon}
      />
      <ColumnModal
        visible={columnVisible}
        onClose={() => setColumnVisible(false)}
      />
      <CreditsModal
        visible={creditsVisible}
        onClose={() => setCreditsVisible(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
  },
  title: {
    fontSize: 44,
    letterSpacing: 2,
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 20,
    marginBottom: 40,
  },
  botList: {
    width: "100%",
    marginBottom: 40,
  },
  botRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: 0.5,
    paddingVertical: 12,
  },
  difficultyPill: {
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  startButton: {
    width: "100%",
    alignItems: "center",
    paddingVertical: 14,
  },
  onlineButton: {
    width: "100%",
    alignItems: "center",
    paddingVertical: 14,
    borderWidth: 1,
    marginTop: 12,
  },
  rulesLink: {
    marginTop: 18,
    paddingVertical: 6,
  },
  linkRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: 18,
  },
});
