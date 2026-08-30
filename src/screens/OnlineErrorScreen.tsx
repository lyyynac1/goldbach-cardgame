import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTheme } from "../ThemeContext";

type Props = {
  // "closed" はサーバー側から切断された場合(部屋の破棄、サービス終了)、
  // "error" は接続そのものに失敗した場合。
  reason: "closed" | "error";
  message: string | null;
  onSolo: () => void;
  onBackToHome: () => void;
};

export function OnlineErrorScreen({
  reason,
  message,
  onSolo,
  onBackToHome,
}: Props) {
  const theme = useTheme();

  const title =
    reason === "closed" ? "通信対戦が終了しました" : "接続できませんでした";

  const detail =
    message ??
    (reason === "closed"
      ? "対戦相手との接続が切れたか、通信対戦のサービスが終了しています。"
      : "通信対戦を利用できません。");

  const body = `${detail}\nひとりで遊ぶことはできます。`;

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
        {title}
      </Text>

      <Text
        style={[
          styles.body,
          {
            color: theme.colors.textSecondary,
            fontFamily: theme.typography.body.fontFamily,
          },
        ]}
      >
        {body}
      </Text>

      <Pressable
        onPress={onSolo}
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
          ひとりで遊ぶ
        </Text>
      </Pressable>

      <Pressable onPress={onBackToHome} style={styles.backLink} hitSlop={8}>
        <Text
          style={{
            color: theme.colors.textSecondary,
            fontFamily: theme.typography.body.fontFamily,
            fontSize: 16,
          }}
        >
          ホームにもどる
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
  title: {
    fontSize: 30,
    letterSpacing: 1,
    marginBottom: 14,
    textAlign: "center",
  },
  body: {
    fontSize: 15,
    lineHeight: 24,
    marginBottom: 44,
    textAlign: "center",
  },
  mainButton: {
    width: "100%",
    alignItems: "center",
    paddingVertical: 14,
  },
  backLink: {
    marginTop: 24,
    paddingVertical: 6,
  },
});
