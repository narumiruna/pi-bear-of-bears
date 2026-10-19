import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { towerFacts } from "../src/workflow-parsers.js";
import { inventoryText, NOW, workflowHarness } from "./fixtures/workflow.js";

// 765525 原生入口格式；移除與解析無關的其他玩家排行榜。
const nativeEntry = `🗼 無盡星塔 — 每一層都是一顆未墜之星的倒影
📜 個人最佳：第 58 層｜入塔 10 次
🎫 入場：🌠碎晶×2 或 🪙300,000（自動擇一）
🚪 /tower go 開始挑戰（自第 53 層起）——需站在 🗼星塔前庭
　⏫ 想略過低樓？/tower go 59（可指定第 1～59 層起，直達你的挑戰前線）`;

// 765599：原生免費入口；沿用已觀察的入口格式，去除其他玩家排行榜。
const nativeFreeEntry = nativeEntry.replace(
  "🎫 入場：🌠碎晶×2 或 🪙300,000（自動擇一）",
  "🎫 入場：🎁 今日首戰免費",
);

beforeEach(() => vi.spyOn(Date, "now").mockReturnValue(NOW));
afterEach(() => vi.restoreAllMocks());

test("原生入口明示最佳、可選樓層與兩種費用；保留原始報價，不猜自動扣款順序", () => {
  expect(towerFacts(nativeEntry)).toMatchObject({
    best: 58,
    floor: null,
    hp: null,
    starts: Array.from({ length: 59 }, (_, index) => index + 1),
    challengeKnown: true,
    conflicts: [],
    pricing: {
      kind: "paid",
      crystals: 2,
      gold: 300000,
      automaticChoice: true,
      selectionRule: null,
      quote: "🎫 入場：🌠碎晶×2 或 🪙300,000（自動擇一）",
    },
  });
});

test.each([
  "🎫 入場：🌠碎晶×2 或 🪙300,000（自動擇一，另收稅）",
  "🎫 入場：🌠碎晶×2 或 🪙300,00（自動擇一）",
  "🎫 入場：🌠碎晶×2 或 300,000（自動擇一）",
  "🎫 入場：🌠碎晶×9007199254740992 或 🪙300,000（自動擇一）",
])("原生費用未完整識別時保守阻擋：%s", (fee) => {
  const text = nativeEntry.replace(/^🎫.*$/mu, fee);
  expect(towerFacts(text)?.pricing.kind).toBe("unknown");
  expect(towerFacts(`${text}\n入場費：今日首戰免費`)?.pricing.kind).toBe(
    "unknown",
  );
});

test.each([
  ["入場費：300,001G", "入場費"],
  ["可選起始樓層：1–58", "起始樓層"],
  ["個人最佳：57", "最佳"],
  ["🎫 入場：🌠碎晶×2 或 🪙300,000（自動擇一）", "原生"],
])("原生與重複／衝突欄位不混成可執行入口：%s", (extra, field) => {
  const facts = towerFacts(`${nativeEntry}\n${extra}`);
  expect(facts?.conflicts.join(" ")).toContain(field);
  expect(facts?.pricing.kind).toBe("unknown");
});

test.each([
  "可指定第 1～9007199254740992 層起",
  "可指定第 1～1002 層起",
  "可指定第 1～59 層起，另有資格限制",
])("原生起始範圍非法／未完整識別時不保留可選樓層：%s", (range) => {
  const text = nativeEntry.replace("可指定第 1～59 層起", range);
  expect(towerFacts(text)?.starts).toEqual([]);
  expect(towerFacts(text)?.pricing.kind).toBe("unknown");
});

test.each([
  "需完成任務才可入塔",
  "手續費：500G",
  "外加門票一張",
  "僅限持有稱號者",
])("原生入口外的未識別費用／限制也阻擋：%s", (restriction) => {
  expect(towerFacts(`${nativeEntry}\n${restriction}`)?.pricing.kind).toBe(
    "unknown",
  );
});

test("原生入口不能自行補出免費資格或主動挑戰樓層", () => {
  const facts = towerFacts(nativeEntry);
  expect(facts?.pricing.kind).not.toBe("free");
  expect(facts?.floor).toBeNull();
  expect(towerFacts(nativeEntry.replace(/^🚪.*\n/mu, ""))?.challengeKnown).toBe(
    false,
  );
});

test("原生免費入口辨識明示零費用；不變更挑戰身分或入塔", async () => {
  expect(towerFacts(nativeFreeEntry)).toMatchObject({
    best: 58,
    floor: null,
    challengeKnown: true,
    conflicts: [],
    pricing: {
      kind: "free",
      gold: 0,
      crystals: 0,
      automaticChoice: false,
      selectionRule: null,
      quote: "🎫 入場：🎁 今日首戰免費",
    },
  });
  const app = workflowHarness();
  app.seed();
  app.overrides.set("/tower", () => nativeFreeEntry);
  const result = await app.call("bears_tower_entry_check", {
    character: "測試熊",
    floor: 59,
    freeOnly: true,
  });
  expect(result.state).toBe("ready");
  expect(result.data.selectedPayment).toEqual({ currency: "free", amount: 0 });
  expect(result.data.eligible).toBe(true);
  expect(app.sent).toEqual(["/status", "/tower"]);
});

test.each([
  nativeFreeEntry.replace("今日首戰免費", "今日首戰免費已使用"),
  nativeFreeEntry.replace("今日首戰免費", "今日首戰免費（另收稅）"),
  `${nativeFreeEntry}\n今日首戰免費已使用`,
  `${nativeFreeEntry}\n🎫 入場：🎁 今日首戰免費`,
  `${nativeFreeEntry}\n入場費：300,000G`,
  `${nativeFreeEntry}\n外加門票一張`,
])("免費入口否定、重複、額外費用或矛盾不判免費：%s", (text) => {
  const result = towerFacts(text);
  expect(result?.pricing.kind).toBe("unknown");
  expect(result?.pricing.gold).toBeNull();
  expect(result?.pricing.crystals).toBeNull();
});

test("入口流程辨識原生59與報價後，仍因自動擇一規則未知而停止，不入塔", async () => {
  const app = workflowHarness();
  app.seed();
  app.state.gold = 400000;
  app.overrides.set("/tower", () => nativeEntry);
  app.overrides.set(
    "/inventory all",
    () =>
      `${inventoryText().replace("3 種", "4 種")}\n  4. 星核碎晶 x5 — 入塔材料`,
  );
  const result = await app.call("bears_tower_entry_check", {
    character: "測試熊",
    floor: 59,
    freeOnly: false,
  });
  expect(result.data.tower).toMatchObject({
    best: 58,
    starts: Array.from({ length: 59 }, (_, index) => index + 1),
    pricing: { kind: "paid", crystals: 2, gold: 300000, selectionRule: null },
  });
  expect(result.state).toBe("needs_observation");
  expect(result.data.selectedPayment).toBeNull();
  expect(app.sent.some((command) => command.startsWith("/tower go"))).toBe(
    false,
  );
});
