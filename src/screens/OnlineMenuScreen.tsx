import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTheme } from "../ThemeContext";

type Props = {
  onCreateRoom: () => void;
  onJoinRoom: () => void;
  onBack: () => void;
};

export function OnlineMenuScreen({ onCreateRoom, onJoinRoom, onBack }: Props) {
  const theme = useTheme();

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
        通信対戦
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
        招待コードを使って対戦します
      </Text>

      <Pressable
        onPress={onCreateRoom}
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
          部屋をつくる
        </Text>
      </Pressable>

      <Pressable
        onPress={onJoinRoom}
        style={[
          styles.mainButton,
          {
            borderColor: theme.colors.border,
            borderWidth: 1,
            borderRadius: theme.radius.control,
          },
        ]}
      >
        <Text
          style={{
            color: theme.colors.textPrimary,
            fontFamily: theme.typography.body.fontFamily,
            fontSize: 22,
          }}
        >
          部屋に入る
        </Text>
      </Pressable>

      <Pressable onPress={onBack} style={styles.backLink} hitSlop={8}>
        <Text
          style={{
            color: theme.colors.textSecondary,
            fontFamily: theme.typography.body.fontFamily,
            fontSize: 16,
          }}
        >
          もどる
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
    fontSize: 40,
    letterSpacing: 2,
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 17,
    marginBottom: 48,
  },
  mainButton: {
    width: "100%",
    alignItems: "center",
    paddingVertical: 14,
    marginBottom: 16,
  },
  backLink: {
    marginTop: 24,
    paddingVertical: 6,
  },
});
