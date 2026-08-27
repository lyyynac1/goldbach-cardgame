const { withAppBuildGradle } = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

/**
 * リリース用の署名設定を android/app/build.gradle に注入する config plugin。
 *
 * 重要: このプラグイン(Node.js側)は keystore.properties の値を一切読み込まない。
 * 注入するのは「実行時に keystore.properties を読む Gradle(Groovy) コード」だけで、
 * パスワード等の実際の値は生成物(build.gradle)には一切埋め込まれない。
 * 値の読み込み・展開はすべて Gradle ビルド実行時に Groovy 側で行われる。
 *
 * `expo prebuild` は android/ を毎回テンプレートから作り直すため、
 * build.gradle への手動編集は次回の prebuild で消えてしまう。
 * このプラグインを app.json の "plugins" に登録しておくことで、
 * prebuild のたびに自動で同じ Gradle コードが復元される。
 *
 * keystore.properties はリポジトリのルート直下に置く想定。
 * (android/ は生成物なので、そこに置くと prebuild のたびに消える)
 * このファイル自体と、参照する .jks/.keystore はコミットしないこと
 * (.gitignore で除外済み)。
 *
 * keystore.properties の書式:
 *   storeFile=/absolute/path/to/release.keystore  (絶対パス、またはリポジトリルートからの相対パス)
 *   storePassword=xxxx
 *   keyAlias=xxxx
 *   keyPassword=xxxx
 */

// android/app/build.gradle から見て "../keystore.properties" = リポジトリルート/keystore.properties
const KEYSTORE_PROPERTIES_LOADER =
  "    def keystorePropertiesFile = rootProject.file(\"../keystore.properties\")\n" +
  "    def keystoreProperties = new Properties()\n" +
  "    if (keystorePropertiesFile.exists()) {\n" +
  "        keystoreProperties.load(new FileInputStream(keystorePropertiesFile))\n" +
  "    }\n";

const RELEASE_SIGNING_CONFIG_BLOCK =
  "        release {\n" +
  "            if (keystorePropertiesFile.exists()) {\n" +
  "                storeFile rootProject.file(keystoreProperties['storeFile'])\n" +
  "                storePassword keystoreProperties['storePassword']\n" +
  "                keyAlias keystoreProperties['keyAlias']\n" +
  "                keyPassword keystoreProperties['keyPassword']\n" +
  "            }\n" +
  "        }\n";

const OLD_RELEASE_SIGNING_LINE =
  "            // Caution! In production, you need to generate your own keystore file.\n" +
  "            // see https://reactnative.dev/docs/signed-apk-android.\n" +
  "            signingConfig signingConfigs.debug";

// keystore.properties が無い場合は debug 鍵にフォールバックする
const NEW_RELEASE_SIGNING_LINE =
  "            // Caution! In production, you need to generate your own keystore file.\n" +
  "            // see https://reactnative.dev/docs/signed-apk-android.\n" +
  "            signingConfig keystorePropertiesFile.exists() ? signingConfigs.release : signingConfigs.debug";

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (config) => {
    // 値は読まない。存在確認のみ(prebuild時の案内表示用)。
    const keystorePropertiesPath = path.join(
      config.modRequest.projectRoot,
      "keystore.properties"
    );
    if (!fs.existsSync(keystorePropertiesPath)) {
      console.warn(
        "[withReleaseSigning] keystore.properties が見つからないため、release ビルドは debug 鍵にフォールバックします。"
      );
    }

    let contents = config.modResults.contents;

    if (!contents.includes("def keystorePropertiesFile")) {
      contents = contents.replace(
        "    signingConfigs {\n",
        KEYSTORE_PROPERTIES_LOADER + "    signingConfigs {\n" + RELEASE_SIGNING_CONFIG_BLOCK
      );
    }

    if (contents.includes(OLD_RELEASE_SIGNING_LINE)) {
      contents = contents.replace(OLD_RELEASE_SIGNING_LINE, NEW_RELEASE_SIGNING_LINE);
    }

    config.modResults.contents = contents;
    return config;
  });
};
