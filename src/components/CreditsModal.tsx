import React from "react";
import {
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useTheme } from "../ThemeContext";
import { GITHUB_REPO_URL } from "../content/columnContent";
import {
  APP_VERSION,
  MEMBERS,
  OSS_LICENSES,
  TEAM_NAME,
  TERMS_SECTIONS,
} from "../content/creditsContent";

export function CreditsModal({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const theme = useTheme();

  const handleGitHubPress = () => {
    Linking.openURL(GITHUB_REPO_URL).catch(() => {
      console.error("Failed to open URL");
    });
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View
        style={[styles.container, { backgroundColor: theme.colors.background }]}
      >
        <View style={styles.header}>
          <Text
            style={[
              styles.title,
              {
                color: theme.colors.textPrimary,
                fontFamily: theme.typography.display.fontFamily,
              },
            ]}
          >
            クレジット
          </Text>
          <Pressable onPress={onClose} hitSlop={12}>
            <Text
              style={{
                color: theme.colors.accentGold,
                fontFamily: theme.typography.body.fontFamily,
                fontSize: 20,
              }}
            >
              閉じる
            </Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.scrollContent}>
          {/* アプリ名・バージョン */}
          <Text
            style={[
              styles.appName,
              {
                color: theme.colors.accentGold,
                fontFamily: theme.typography.display.fontFamily,
              },
            ]}
          >
            ゴールドバッハ
          </Text>
          <Text
            style={[
              styles.version,
              {
                color: theme.colors.textSecondary,
                fontFamily: theme.typography.numeral.fontFamily,
              },
            ]}
          >
            version {APP_VERSION}
          </Text>

          {/* 制作 */}
          <View style={styles.section}>
            <Text
              style={[
                styles.sectionHeading,
                {
                  color: theme.colors.textPrimary,
                  fontFamily: theme.typography.body.fontFamily,
                },
              ]}
            >
              制作
            </Text>
            <Text
              style={[
                styles.teamName,
                {
                  color: theme.colors.textPrimary,
                  fontFamily: theme.typography.body.fontFamily,
                },
              ]}
            >
              {TEAM_NAME}
            </Text>
            {MEMBERS.map((name, i) => (
              <Text
                key={i}
                style={[
                  styles.memberName,
                  {
                    color: theme.colors.textSecondary,
                    fontFamily: theme.typography.body.fontFamily,
                  },
                ]}
              >
                {name}
              </Text>
            ))}
          </View>

          {/* 利用条件・免責事項など */}
          {TERMS_SECTIONS.map((section, i) => (
            <View key={i} style={styles.section}>
              <Text
                style={[
                  styles.sectionHeading,
                  {
                    color: theme.colors.textPrimary,
                    fontFamily: theme.typography.body.fontFamily,
                  },
                ]}
              >
                {section.heading}
              </Text>
              <Text
                style={[
                  styles.sectionBody,
                  {
                    color: theme.colors.textPrimary,
                    fontFamily: theme.typography.body.fontFamily,
                  },
                ]}
              >
                {section.body}
              </Text>
            </View>
          ))}

          {/* OSS ライセンス */}
          <View style={styles.section}>
            <Text
              style={[
                styles.sectionHeading,
                {
                  color: theme.colors.textPrimary,
                  fontFamily: theme.typography.body.fontFamily,
                },
              ]}
            >
              使用しているソフトウェア
            </Text>
            {OSS_LICENSES.map((oss, i) => (
              <View
                key={i}
                style={[styles.ossItem, { borderColor: theme.colors.border }]}
              >
                <Text
                  style={[
                    styles.ossName,
                    {
                      color: theme.colors.textPrimary,
                      fontFamily: theme.typography.body.fontFamily,
                    },
                  ]}
                >
                  {oss.name}
                </Text>
                <Text
                  style={[
                    styles.ossMeta,
                    {
                      color: theme.colors.textSecondary,
                      fontFamily: theme.typography.body.fontFamily,
                    },
                  ]}
                >
                  {oss.license}
                </Text>
                <Text
                  style={[
                    styles.ossMeta,
                    {
                      color: theme.colors.textSecondary,
                      fontFamily: theme.typography.body.fontFamily,
                    },
                  ]}
                >
                  {oss.copyright}
                </Text>
              </View>
            ))}
          </View>

          {/* 効果音の出所を明示 */}
          <View style={styles.section}>
            <Text
              style={[
                styles.sectionHeading,
                {
                  color: theme.colors.textPrimary,
                  fontFamily: theme.typography.body.fontFamily,
                },
              ]}
            >
              素材について
            </Text>
            <Text
              style={[
                styles.sectionBody,
                {
                  color: theme.colors.textPrimary,
                  fontFamily: theme.typography.body.fontFamily,
                },
              ]}
            >
              効果音はプログラムにより合成した自作データです。カードデザイン・アイコンはすべて自作です。
              第三者の著作物は使用していません。
            </Text>
          </View>

          <View style={styles.linkSection}>
            <Pressable
              onPress={handleGitHubPress}
              style={[styles.githubLink, { borderColor: theme.colors.border }]}
            >
              <Text
                style={[
                  styles.githubLinkText,
                  {
                    color: theme.colors.accentGold,
                    fontFamily: theme.typography.body.fontFamily,
                  },
                ]}
              >
                ソースコード (GitHub)
              </Text>
            </Pressable>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: 56,
    paddingHorizontal: 20,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 14,
  },
  title: {
    fontSize: 28,
  },
  scrollContent: {
    paddingBottom: 40,
  },
  appName: {
    fontSize: 30,
    marginBottom: 2,
  },
  version: {
    fontSize: 16,
    marginBottom: 24,
  },
  section: {
    marginBottom: 22,
  },
  sectionHeading: {
    fontSize: 25,
    fontWeight: "700",
    marginBottom: 8,
  },
  sectionBody: {
    fontSize: 20,
    lineHeight: 28,
  },
  teamName: {
    fontSize: 22,
    marginBottom: 6,
  },
  memberName: {
    fontSize: 20,
    lineHeight: 28,
  },
  ossItem: {
    borderBottomWidth: 0.5,
    paddingVertical: 10,
  },
  ossName: {
    fontSize: 19,
    marginBottom: 2,
  },
  ossMeta: {
    fontSize: 15,
    lineHeight: 20,
  },
  linkSection: {
    marginTop: 32,
    paddingTop: 24,
    borderTopWidth: 0.5,
  },
  githubLink: {
    borderWidth: 0.5,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: "center",
  },
  githubLinkText: {
    fontSize: 16,
    fontWeight: "600",
  },
});
