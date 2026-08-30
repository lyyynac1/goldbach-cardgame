import React, { useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTheme } from "../ThemeContext";
import { FieldArea, PlayAnimationInfo } from "../components/FieldArea";
import { HandRow } from "../components/HandRow";
import { ActionBar } from "../components/ActionBar";
import { getLegalActions } from "../engine/rules";
import { Action, Card, GameState } from "../engine/types";
import { GameView } from "../state/useOnlineRoom";
import {
  WireAction,
  WireActionKind,
  cardsToWire,
  wireToCards,
} from "../state/wireCard";

type Props = {
  view: GameView;
  turnDeadline: number | null;
  onAction: (action: WireAction) => void;
  onExit: () => void;
};

function cardKey(c: Card): string {
  return `${c.suit}-${c.rank}`;
}

/** 選択したカードと一致する合法手を探す。useGameSession と同じ判定。 */
function findMatchingAction(
  legal: Action[],
  selected: Card[],
): Action | undefined {
  if (selected.length === 0) return undefined;
  const selectedKeys = selected.map(cardKey).sort();
  return legal.find((a) => {
    if (a.type === "pass") return false;
    if (a.cards.length !== selected.length) return false;
    const keys = a.cards.map(cardKey).sort();
    return keys.every((k, i) => k === selectedKeys[i]);
  });
}

/** Action の種別を、サーバーへ送る数値へ変換する。 */
function actionKindToWire(type: Action["type"]): number {
  switch (type) {
    case "lead":
      return WireActionKind.Lead;
    case "beat":
      return WireActionKind.Beat;
    case "divisor":
      return WireActionKind.Divisor;
    default:
      return WireActionKind.Pass;
  }
}

export function OnlineGameScreen({
  view,
  turnDeadline,
  onAction,
  onExit,
}: Props) {
  const theme = useTheme();
  const [selected, setSelected] = useState<Card[]>([]);
  const [remainingSec, setRemainingSec] = useState<number | null>(null);

  // 期限までの残り秒数を1秒ごとに更新する。
  useEffect(() => {
    if (turnDeadline === null) {
      setRemainingSec(null);
      return;
    }
    const tick = () => {
      const left = Math.max(0, Math.ceil((turnDeadline - Date.now()) / 1000));
      setRemainingSec(left);
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [turnDeadline]);

  const hand = useMemo(() => wireToCards(view.selfHand), [view.selfHand]);
  const field = useMemo(
    () => ({
      cards: wireToCards(view.field.cards),
      score: view.field.score,
      table: view.field.table,
      lastPlayCount: view.field.lastPlayCount,
    }),
    [view.field],
  );

  const isMyTurn = view.currentSeat === view.selfSeat;

  // getLegalActions は自分の手札と場しか参照しないため、
  // 他人の手札を持たないクライアントでもダミーの GameState で判定できる。
  const legalActions = useMemo<Action[]>(() => {
    const dummy = {
      players: [{ id: view.selfSeat, hand, passed: false, isBot: false }],
      field,
      currentPlayerId: view.currentSeat,
      finished: view.finished,
      pendingAgari: null,
    } as unknown as GameState;
    return getLegalActions(dummy, view.selfSeat);
  }, [hand, field, view.selfSeat, view.currentSeat, view.finished]);

  const matchingAction = useMemo(
    () => findMatchingAction(legalActions, selected),
    [legalActions, selected],
  );

  const canPass = legalActions.some((a) => a.type === "pass");
  // 誰かが行動するたびにカードが飛んでくる演出を出す。
  // nonce を変えることで、同じ方向からの連続の手でも再生される。
  const nonceRef = useRef(0);
  const [playAnimation, setPlayAnimation] = useState<PlayAnimationInfo | null>(
    null,
  );
  const [passSeat, setPassSeat] = useState<number | null>(null);

  useEffect(() => {
    const last = view.lastAction;
    if (!last) return;

    // pass は場が変わらないので、代わりに文字で知らせる。
    if (last.kind === WireActionKind.Pass) {
      setPassSeat(last.seat);
      const timer = setTimeout(() => setPassSeat(null), 1200);
      return () => clearTimeout(timer);
    }

    nonceRef.current += 1;
    const isSelf = last.seat === view.selfSeat;
    const others = view.opponents.map((o) => o.seat);
    const index = others.indexOf(last.seat);
    const count = others.length;
    const spread = 100;
    const originX =
      isSelf || count <= 1
        ? 0
        : (index - (count - 1) / 2) * (spread / Math.max(1, count - 1));

    setPassSeat(null);
    setPlayAnimation({
      nonce: nonceRef.current,
      originX,
      originY: isSelf ? 130 : -130,
    });
  }, [view.lastAction, view.selfSeat, view.opponents]);

  // 場が流れたときの残像。表示するのは「流れる直前の場」ではなく
  // 「場を流した張本人が出した手」(サーバーの lastClearedField)。
  // seq が増えたときだけ新しい出来事として扱う。同じ state の再配信
  // (入室・切断→bot化など)では seq が変化しないので再発火しない。
  const prevSeqRef = useRef<number>(-1);
  const [clearedSnapshot, setClearedSnapshot] = useState<Card[] | null>(null);
  useEffect(() => {
    if (view.seq === prevSeqRef.current) return;
    prevSeqRef.current = view.seq;
    if (!view.lastClearedField || view.lastClearedField.length === 0) return;
    setClearedSnapshot(wireToCards(view.lastClearedField));
    const timer = setTimeout(() => setClearedSnapshot(null), 1200);
    return () => clearTimeout(timer);
  }, [view.seq, view.lastClearedField]);

  const toggleCard = (card: Card) => {
    setSelected((prev) =>
      prev.some((c) => cardKey(c) === cardKey(card))
        ? prev.filter((c) => cardKey(c) !== cardKey(card))
        : [...prev, card],
    );
  };

  const play = () => {
    if (!matchingAction || matchingAction.type === "pass") return;
    onAction({
      kind: actionKindToWire(matchingAction.type),
      cards: cardsToWire(matchingAction.cards),
    });
    setSelected([]);
  };

  const pass = () => {
    onAction({ kind: WireActionKind.Pass, cards: [] });
    setSelected([]);
  };

  const currentPlayerLabel = isMyTurn
    ? "あなた"
    : view.opponents.find((o) => o.seat === view.currentSeat)?.isBot
      ? "コンピュータ"
      : `プレイヤー${view.currentSeat + 1}`;

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: theme.colors.background }]}
    >
      <View style={styles.topSection}>
        <Text
          onPress={onExit}
          style={{
            color: theme.colors.textSecondary,
            fontFamily: theme.typography.body.fontFamily,
            fontSize: 16,
            paddingVertical: 6,
          }}
        >
          退出する
        </Text>

        <View style={styles.opponentRow}>
          {view.opponents.map((op) => (
            <View
              key={op.seat}
              style={[
                styles.opponentBox,
                {
                  borderColor:
                    view.currentSeat === op.seat
                      ? theme.colors.accentGold
                      : theme.colors.border,
                  borderRadius: theme.radius.panel,
                },
              ]}
            >
              <Text
                style={{
                  color: theme.colors.textPrimary,
                  fontFamily: theme.typography.body.fontFamily,
                  fontSize: 14,
                }}
              >
                {op.isBot ? "コンピュータ" : `プレイヤー${op.seat + 1}`}
              </Text>
              <Text
                style={{
                  color: theme.colors.textSecondary,
                  fontFamily: theme.typography.numeral.fontFamily,
                  fontSize: 18,
                  marginTop: 2,
                }}
              >
                {op.handCount}枚
              </Text>
              {(op.passed || passSeat === op.seat) && (
                <Text
                  style={{
                    color:
                      passSeat === op.seat
                        ? theme.colors.accentGold
                        : theme.colors.textSecondary,
                    fontFamily: theme.typography.body.fontFamily,
                    fontSize: 12,
                  }}
                >
                  パス
                </Text>
              )}
            </View>
          ))}
        </View>
      </View>

      <View style={styles.middleSection}>
        <FieldArea
          field={field}
          clearedSnapshot={clearedSnapshot}
          playAnimation={playAnimation}
        />
      </View>

      <View style={styles.bottomSection}>
        {isMyTurn && remainingSec !== null && (
          <Text
            style={[
              styles.timer,
              {
                color:
                  remainingSec <= 10
                    ? theme.colors.accentGoldStrong
                    : theme.colors.textSecondary,
                fontFamily: theme.typography.numeral.fontFamily,
              },
            ]}
          >
            のこり {remainingSec} 秒
          </Text>
        )}
        <HandRow
          hand={hand}
          selected={selected}
          onToggle={toggleCard}
          disabled={!isMyTurn}
        />
        <ActionBar
          isMyTurn={isMyTurn}
          canPlay={!!matchingAction}
          canPass={canPass}
          selectedCount={selected.length}
          onPlay={play}
          onPass={pass}
          humanPassed={false}
          humanPassWasForced={false}
          isForcedPassPending={false}
          currentPlayerName={currentPlayerLabel}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
  },
  topSection: {},
  opponentRow: {
    flexDirection: "row",
    justifyContent: "space-around",
    marginTop: 8,
  },
  opponentBox: {
    borderWidth: 1,
    paddingVertical: 10,
    paddingHorizontal: 14,
    alignItems: "center",
  },
  middleSection: {
    flex: 1,
    justifyContent: "center",
  },
  timer: {
    fontSize: 16,
    textAlign: "center",
    marginBottom: 6,
  },
  bottomSection: {},
});
