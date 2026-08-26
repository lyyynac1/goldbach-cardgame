// クレジット画面の表示内容
// メンバー名・URLは確定後にここだけ差し替える

export const TEAM_NAME = "ゴールドバッハ製作委員会";
export const APP_VERSION = "1.0.0";

// TODO: 確定後に実名/ハンドルネームへ差し替え
export const MEMBERS: string[] = [
  "【メンバー1】",
  "【メンバー2】",
  "【メンバー3】",
];

export interface CreditsSection {
  heading: string;
  body: string;
}

export const TERMS_SECTIONS: CreditsSection[] = [
  {
    heading: "利用条件",
    body:
      "本アプリは個人での利用を目的としてご利用ください。" +
      "本アプリ(APKファイル)の再配布、商用利用、および改変したものの公開・配布はご遠慮ください。",
  },
  {
    heading: "ソースコードについて",
    body:
      "本ゲームのソースコードは MIT License にて公開しています。" +
      "ソースコードの利用については同ライセンスの条件が適用されます。" +
      "上記の利用条件は、配布されたアプリケーション本体に対するものです。",
  },
  {
    heading: "個人情報の取り扱い",
    body:
      "本アプリは外部サーバーとの通信を一切行わず、個人情報を収集しません。" +
      "ゲームの進行状況および実績記録は、お使いの端末内にのみ保存されます。" +
      "アプリを削除すると、これらのデータも完全に削除されます。",
  },
  {
    heading: "免責事項",
    body:
      "本アプリのご利用は、利用者ご自身の責任において行っていただくものとします。" +
      "本アプリの利用に起因して端末に生じた不具合、データの消失その他の損害について、" +
      "制作者は責任を負いかねます。また、技術的なサポートは行っておりません。",
  },
];

export interface OssLicense {
  name: string;
  license: string;
  copyright: string;
}

// SIL OFL はライセンス表記と著作権表示の同梱が条件
export const OSS_LICENSES: OssLicense[] = [
  {
    name: "Shippori Mincho",
    license: "SIL Open Font License 1.1",
    copyright: "Copyright 2020 The Shippori Mincho Project Authors",
  },
  {
    name: "Zen Kaku Gothic New",
    license: "SIL Open Font License 1.1",
    copyright: "Copyright 2020 The Zen Kaku Gothic New Project Authors",
  },
  {
    name: "Space Mono",
    license: "SIL Open Font License 1.1",
    copyright: "Copyright 2016 The Space Mono Project Authors",
  },
  {
    name: "React / React Native",
    license: "MIT License",
    copyright: "Copyright (c) Meta Platforms, Inc. and affiliates.",
  },
  {
    name: "Expo",
    license: "MIT License",
    copyright: "Copyright (c) 650 Industries, Inc.",
  },
];
