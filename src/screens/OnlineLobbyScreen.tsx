import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTheme } from "../ThemeContext";

type Props = {
  inviteCode: string | null;
  connectedCount: number;
  isHost: boolean;
  onStart: () => void;
  onLeave: () => void;
};

export function OnlineLobbyScreen({
  inviteCode,
  connectedCount,
  isHost,
  onStart,
  onLeave,
}: Props) {
  const theme = useTheme();

  // 1人だけの状態で開始してもコンピュータ3体との対戦になり、
  // 通信対戦の意味がないため、2人以上揃うまで開始できないようにする。
  const canStart = isHost && connectedCount >= 2;

  const statusText = isHost
    ? "対戦相手の参加を待っています"
    : "ホストの開始を待っています";

  return (
    <View
      style={[styles.container, { backgroundColor: theme.colors.background }]}
    >
      <Text
        style={[
          styles.label,
          {
            color: theme.colors.textSecondary,
            fontFamily: theme.typography.body.fontFamily,
          },
        ]}
      >
        招待コード
      </Text>

      <Text
        style={[
          styles.code,
          {
            color: theme.colors.accentGold,
            fontFamily: theme.typography.numeral.fontFamily,
          },
        ]}
      >
        {inviteCode ?? "————"}
      </Text>

      <Text
        style={[
          styles.hint,
          {
            color: theme.colors.textSecondary,
            fontFamily: theme.typography.body.fontFamily,
          },
        ]}
      >
        このコードを対戦相手に伝えてください
      </Text>

      <View
        style={[
          styles.countBox,
          {
            borderColor: theme.colors.border,
            borderRadius: theme.radius.panel,
          },
        ]}
      >
        <Text
          style={{
            color: theme.colors.textPrimary,
            fontFamily: theme.typography.numeral.fontFamily,
            fontSize: 32,
          }}
        >
          {connectedCount} / 4
        </Text>
        <Text
          style={{
            color: theme.colors.textSecondary,
            fontFamily: theme.typography.body.fontFamily,
            fontSize: 14,
            marginTop: 4,
          }}
        >
          空席はコンピュータが担当します
        </Text>
      </View>

      {canStart ? (
        <Pressable
          onPress={onStart}
          style={[
            styles.mainButton,
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
              fontSize: 22,
            }}
          >
            対戦をはじめる
          </Text>
        </Pressable>
      ) : (
        <Text
          style={[
            styles.status,
            {
              color: theme.colors.textSecondary,
              fontFamily: theme.typography.body.fontFamily,
            },
          ]}
        >
          {statusText}
        </Text>
      )}

      <Pressable onPress={onLeave} style={styles.backLink} hitSlop={8}>
        <Text
          style={{
            color: theme.colors.textSecondary,
            fontFamily: theme.typography.body.fontFamily,
            fontSize: 16,
          }}
        >
          退出する
        </Text>
      </Pressable>
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
  label: {
    fontSize: 15,
    letterSpacing: 1,
    marginBottom: 8,
  },
  code: {
    fontSize: 44,
    letterSpacing: 6,
    marginBottom: 12,
  },
  hint: {
    fontSize: 14,
    marginBottom: 40,
  },
  countBox: {
    borderWidth: 1,
    paddingVertical: 20,
    paddingHorizontal: 40,
    alignItems: "center",
    marginBottom: 40,
  },
  mainButton: {
    width: "100%",
    alignItems: "center",
    paddingVertical: 14,
  },
  status: {
    fontSize: 16,
    paddingVertical: 14,
  },
  backLink: {
    marginTop: 24,
    paddingVertical: 6,
  },
});
