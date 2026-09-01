import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTheme } from "../ThemeContext";
import { GameView, RematchStatus } from "../state/useOnlineRoom";
type Props = {
  view: GameView;
  onBackToHome: () => void;
  onVoteRematch: () => void;
  rematchStatus: RematchStatus | null;
  hasVotedRematch: boolean;
};

export function OnlineResultScreen({
  view,
  onBackToHome,
  onVoteRematch,
  rematchStatus,
  hasVotedRematch,
}: Props) {
  const theme = useTheme();

  const isWinner = view.winnerSeat === view.selfSeat;
  const winner = view.opponents.find((o) => o.seat === view.winnerSeat);

  const winnerLabel = isWinner
    ? "あなたの勝ちです"
    : winner?.isBot
      ? "コンピュータの勝ちです"
      : `プレイヤー${(view.winnerSeat ?? 0) + 1}の勝ちです`;

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
        対戦終了
      </Text>

      <Text
        style={[
          styles.result,
          {
            color: isWinner
              ? theme.colors.accentGold
              : theme.colors.textPrimary,
            fontFamily: theme.typography.display.fontFamily,
          },
        ]}
      >
        {winnerLabel}
      </Text>

      <View
        style={[
          styles.handBox,
          {
            borderColor: theme.colors.border,
            borderRadius: theme.radius.panel,
          },
        ]}
      >
        <Text
          style={{
            color: theme.colors.textSecondary,
            fontFamily: theme.typography.body.fontFamily,
            fontSize: 14,
            marginBottom: 10,
          }}
        >
          残った手札
        </Text>

        <View style={styles.handRow}>
          <Text
            style={{
              color: theme.colors.textPrimary,
              fontFamily: theme.typography.body.fontFamily,
              fontSize: 15,
            }}
          >
            あなた
          </Text>
          <Text
            style={{
              color: theme.colors.textPrimary,
              fontFamily: theme.typography.numeral.fontFamily,
              fontSize: 18,
            }}
          >
            {view.selfHand.length}枚
          </Text>
        </View>

        {view.opponents.map((op) => (
          <View key={op.seat} style={styles.handRow}>
            <Text
              style={{
                color: theme.colors.textPrimary,
                fontFamily: theme.typography.body.fontFamily,
                fontSize: 15,
              }}
            >
              {op.isBot ? "コンピュータ" : `プレイヤー${op.seat + 1}`}
            </Text>
            <Text
              style={{
                color: theme.colors.textPrimary,
                fontFamily: theme.typography.numeral.fontFamily,
                fontSize: 18,
              }}
            >
              {op.handCount}枚
            </Text>
          </View>
        ))}
      </View>

      {rematchStatus && rematchStatus.requiredSeats.length > 0 && (
        <Text
          style={{
            color: theme.colors.textSecondary,
            fontFamily: theme.typography.body.fontFamily,
            fontSize: 14,
            marginBottom: 14,
          }}
        >
          {rematchStatus.agreedSeats.length}/
          {rematchStatus.requiredSeats.length}
          人が同意しています
        </Text>
      )}

      <Pressable
        onPress={onVoteRematch}
        disabled={hasVotedRematch}
        style={[
          styles.mainButton,
          {
            backgroundColor: hasVotedRematch
              ? theme.colors.border
              : theme.colors.accentGold,
            borderRadius: theme.radius.control,
            marginBottom: 14,
          },
        ]}
      >
        <Text
          style={{
            color: hasVotedRematch
              ? theme.colors.textSecondary
              : theme.colors.onAccentGold,
            fontFamily: theme.typography.body.fontFamily,
            fontSize: 22,
          }}
        >
          {hasVotedRematch ? "同意しました" : "もう一度プレイ"}
        </Text>
      </Pressable>

      <Pressable
        onPress={onBackToHome}
        style={[
          styles.secondaryButton,
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
            fontSize: 18,
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
  label: {
    fontSize: 15,
    letterSpacing: 1,
    marginBottom: 10,
  },
  result: {
    fontSize: 34,
    letterSpacing: 1,
    marginBottom: 40,
    textAlign: "center",
  },
  handBox: {
    width: "100%",
    borderWidth: 1,
    paddingVertical: 18,
    paddingHorizontal: 24,
    marginBottom: 40,
  },
  handRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 6,
  },
  mainButton: {
    width: "100%",
    alignItems: "center",
    paddingVertical: 14,
  },
  secondaryButton: {
    width: "100%",
    alignItems: "center",
    paddingVertical: 12,
    borderWidth: 1,
  },
});
