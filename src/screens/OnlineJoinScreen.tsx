import React, { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useTheme } from "../ThemeContext";

// サーバー側の招待コード仕様に合わせる。
// 紛らわしい文字(0/O, 1/I/L)を除いた大文字英数字、8文字固定。
const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const CODE_LENGTH = 8;

type Props = {
  onJoin: (code: string) => void;
  onBack: () => void;
  errorMessage?: string | null;
};

export function OnlineJoinScreen({ onJoin, onBack, errorMessage }: Props) {
  const theme = useTheme();
  const [code, setCode] = useState("");

  // 大文字に揃えたうえで、許可された文字以外は入力段階で捨てる。
  const handleChange = (text: string) => {
    const filtered = text
      .toUpperCase()
      .split("")
      .filter((ch) => CODE_ALPHABET.includes(ch))
      .join("")
      .slice(0, CODE_LENGTH);
    setCode(filtered);
  };

  const canSubmit = code.length === CODE_LENGTH;

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
        部屋に入る
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
        相手から伝えられた招待コードを入力してください
      </Text>

      <TextInput
        value={code}
        onChangeText={handleChange}
        autoCapitalize="characters"
        autoCorrect={false}
        maxLength={CODE_LENGTH}
        placeholder="————————"
        placeholderTextColor={theme.colors.border}
        style={[
          styles.input,
          {
            color: theme.colors.accentGold,
            borderColor: theme.colors.border,
            borderRadius: theme.radius.control,
            fontFamily: theme.typography.numeral.fontFamily,
          },
        ]}
      />

      <Text
        style={[
          styles.counter,
          {
            color: theme.colors.textSecondary,
            fontFamily: theme.typography.numeral.fontFamily,
          },
        ]}
      >
        {code.length} / {CODE_LENGTH}
      </Text>

      {errorMessage ? (
        <Text
          style={[
            styles.error,
            {
              color: theme.colors.accentTeal,
              fontFamily: theme.typography.body.fontFamily,
            },
          ]}
        >
          {errorMessage}
        </Text>
      ) : null}

      <Pressable
        onPress={() => onJoin(code)}
        disabled={!canSubmit}
        style={[
          styles.mainButton,
          {
            backgroundColor: canSubmit
              ? theme.colors.accentGold
              : theme.colors.border,
            borderRadius: theme.radius.control,
          },
        ]}
      >
        <Text
          style={{
            color: canSubmit
              ? theme.colors.onAccentGold
              : theme.colors.textSecondary,
            fontFamily: theme.typography.body.fontFamily,
            fontSize: 22,
          }}
        >
          参加する
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
    fontSize: 36,
    letterSpacing: 2,
    marginBottom: 8,
  },
  hint: {
    fontSize: 14,
    marginBottom: 36,
    textAlign: "center",
  },
  input: {
    width: "100%",
    borderWidth: 1,
    paddingVertical: 16,
    paddingHorizontal: 20,
    fontSize: 32,
    letterSpacing: 6,
    textAlign: "center",
  },
  counter: {
    fontSize: 14,
    marginTop: 8,
    marginBottom: 28,
  },
  error: {
    fontSize: 15,
    marginBottom: 16,
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
