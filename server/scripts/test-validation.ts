// validation.ts の単体検証。正常系・異常系を一通り試す。
declare const process: { exit(code?: number): void };
import { validateClientMessage } from "../src/validation";
import { ErrorCode } from "../src/protocol";

let failures = 0;
function expectOk(label: string, raw: unknown) {
  const r = validateClientMessage(raw);
  const pass = r.ok === true;
  console.log(`${pass ? "PASS" : "FAIL"}: [受理されるべき] ${label}`);
  if (!pass) failures++;
}
function expectReject(label: string, raw: unknown, expectedCode?: ErrorCode) {
  const r = validateClientMessage(raw);
  const pass = r.ok === false && (expectedCode === undefined || r.code === expectedCode);
  console.log(`${pass ? "PASS" : "FAIL"}: [拒否されるべき] ${label}`);
  if (!pass) failures++;
}

// ---- 正常系 ----
expectOk("joinRequest", { type: "joinRequest" });
expectOk("ping", { type: "ping", nonce: 123 });
expectOk("pass行動", { type: "action", action: { kind: 3, cards: [] } });
expectOk("lead 2枚", {
  type: "action",
  action: { kind: 0, cards: [{ s: 0, r: 1 }, { s: 1, r: 2 }] },
});
expectOk("beat 3枚", {
  type: "action",
  action: {
    kind: 1,
    cards: [{ s: 0, r: 1 }, { s: 1, r: 2 }, { s: 2, r: 3 }],
  },
});
expectOk("divisor 1枚", {
  type: "action",
  action: { kind: 2, cards: [{ s: 0, r: 4 }] },
});

// ---- 異常系: 形式不正 ----
expectReject("null", null, ErrorCode.InvalidMessageShape);
expectReject("配列そのもの", [1, 2, 3], ErrorCode.InvalidMessageShape);
expectReject("未知のtype(自由文字列を含む攻撃を想定)", { type: "chat", text: "hello" }, ErrorCode.InvalidMessageShape);
expectReject("typeが数値", { type: 1 }, ErrorCode.InvalidMessageShape);
expectReject("pingのnonceが文字列", { type: "ping", nonce: "123" }, ErrorCode.OutOfRangeValue);
expectReject("pingのnonceが負数", { type: "ping", nonce: -1 }, ErrorCode.OutOfRangeValue);
expectReject("actionにactionフィールドが無い", { type: "action" }, ErrorCode.InvalidMessageShape);
expectReject("cardsが配列でない", { type: "action", action: { kind: 0, cards: "bad" } }, ErrorCode.InvalidMessageShape);

// ---- 異常系: 値域違反 ----
expectReject("kindが範囲外(99)", { type: "action", action: { kind: 99, cards: [] } }, ErrorCode.OutOfRangeValue);
expectReject(
  "leadで1枚だけ(2or3枚のはず)",
  { type: "action", action: { kind: 0, cards: [{ s: 0, r: 1 }] } },
  ErrorCode.OutOfRangeValue
);
expectReject(
  "passなのにcardsがある",
  { type: "action", action: { kind: 3, cards: [{ s: 0, r: 1 }] } },
  ErrorCode.OutOfRangeValue
);
expectReject(
  "カード配列が長すぎる(4枚)",
  {
    type: "action",
    action: {
      kind: 1,
      cards: [{ s: 0, r: 1 }, { s: 1, r: 2 }, { s: 2, r: 3 }, { s: 3, r: 4 }],
    },
  },
  ErrorCode.OutOfRangeValue
);
expectReject(
  "suitが範囲外(4)",
  { type: "action", action: { kind: 0, cards: [{ s: 4, r: 1 }, { s: 0, r: 2 }] } },
  ErrorCode.OutOfRangeValue
);
expectReject(
  "rankが範囲外(0)",
  { type: "action", action: { kind: 0, cards: [{ s: 0, r: 0 }, { s: 1, r: 2 }] } },
  ErrorCode.OutOfRangeValue
);
expectReject(
  "rankが範囲外(14)",
  { type: "action", action: { kind: 0, cards: [{ s: 0, r: 14 }, { s: 1, r: 2 }] } },
  ErrorCode.OutOfRangeValue
);
expectReject(
  "rankが小数(非整数)",
  { type: "action", action: { kind: 0, cards: [{ s: 0, r: 1.5 }, { s: 1, r: 2 }] } },
  ErrorCode.OutOfRangeValue
);
expectReject(
  "同じカードを2枚重複して出す不正",
  { type: "action", action: { kind: 0, cards: [{ s: 0, r: 5 }, { s: 0, r: 5 }] } },
  ErrorCode.OutOfRangeValue
);

// ---- 異常系: 悪意ある/巨大なペイロードを想定 ----
expectReject(
  "巨大な配列(DoS狙い、1000枚)",
  {
    type: "action",
    action: { kind: 1, cards: Array.from({ length: 1000 }, () => ({ s: 0, r: 1 })) },
  },
  ErrorCode.OutOfRangeValue
);
expectReject("rankにNaN", { type: "action", action: { kind: 0, cards: [{ s: 0, r: NaN }, { s: 1, r: 2 }] } });
expectReject(
  "rankにInfinity",
  { type: "action", action: { kind: 0, cards: [{ s: 0, r: Infinity }, { s: 1, r: 2 }] } }
);

console.log(`\n${failures === 0 ? "すべてPASS" : `${failures}件FAIL`}`);
process.exit(failures === 0 ? 0 : 1);
