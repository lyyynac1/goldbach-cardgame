import React from "react";
import { Linking, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useTheme } from "../ThemeContext";
import { COLUMN_SECTIONS, COLUMN_TITLE, GITHUB_REPO_URL } from "../content/columnContent";

export function ColumnModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const theme = useTheme();

  const handleGitHubPress = () => {
    Linking.openURL(GITHUB_REPO_URL).catch(() => {
      console.error("Failed to open URL");
    });
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
        <View style={styles.header}>
          <Text style={[styles.title, { color: theme.colors.textPrimary, fontFamily: theme.typography.display.fontFamily }]}>
            コラム
          </Text>
          <Pressable onPress={onClose} hitSlop={12}>
            <Text style={{ color: theme.colors.accentGold, fontFamily: theme.typography.body.fontFamily, fontSize: 20 }}>閉じる</Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.scrollContent}>
          <Text
            style={[styles.columnTitle, { color: theme.colors.accentGold, fontFamily: theme.typography.display.fontFamily }]}
          >
            {COLUMN_TITLE}
          </Text>

          {COLUMN_SECTIONS.map((section, i) => (
            <View key={i} style={styles.section}>
              <Text
                style={[styles.sectionHeading, { color: theme.colors.textPrimary, fontFamily: theme.typography.body.fontFamily }]}
              >
                {section.heading}
              </Text>
              <Text
                style={[styles.sectionBody, { color: theme.colors.textPrimary, fontFamily: theme.typography.body.fontFamily }]}
              >
                {section.body}
              </Text>
            </View>
          ))}

          <View style={styles.linkSection}>
            <Pressable onPress={handleGitHubPress} style={[styles.githubLink, { borderColor: theme.colors.border }]}>
              <Text style={[styles.githubLinkText, { color: theme.colors.accentGold, fontFamily: theme.typography.body.fontFamily }]}>
                細説・ソースコード (GitHub)
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
  columnTitle: {
    fontSize: 25,
    marginBottom: 18,
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
    fontSize: 22,
    lineHeight: 25,
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
