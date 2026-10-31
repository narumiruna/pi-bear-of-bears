import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { NOW, statusText, workflowHarness } from "./fixtures/workflow.js";

beforeEach(() => vi.spyOn(Date, "now").mockReturnValue(NOW));
afterEach(() => vi.restoreAllMocks());
const first =
  "🎒 背包（3 種，全列）：\n  1. 🟠⚔️測試巨劍 — 攻擊 +10（Lv1 可裝備）";
const last =
  "2. 🟠🪓測試戰斧 — 攻擊 +8、防禦 +2（Lv1 可裝備）\n  3. 王之精魄 x5 — 進階材料\n\n金幣：1,000 🪙";

test("已綁 request 的背包首頁之連續遲到續頁，不需重新取得 outgoing 才可解析", () => {
  const app = workflowHarness();
  app.observe(statusText(), "/status");
  app.observe(first, "/inventory all");
  app.observe(last);
  expect(app.store.status()?.value.name).toBe("測試熊");
  expect(app.store.inventory()).toBeDefined();
  expect(app.sent).toEqual([]);
});

test.each(["未知資源回報", "/switch 其他熊"])(
  "中間有其他訊息不得把孤立尾頁接回：%s",
  (interruption) => {
    const app = workflowHarness();
    app.observe(statusText(), "/status");
    app.observe(first, "/inventory all");
    app.observe(interruption, undefined, interruption.startsWith("/"));
    app.observe(last);
    expect(app.store.inventory()).toBeUndefined();
    expect(app.sent).toEqual([]);
  },
);

test("過期背包首頁不能讓新孤立尾頁取得查詢資格", () => {
  const app = workflowHarness();
  app.observe(statusText(), "/status");
  app.observe(first, "/inventory all");
  vi.spyOn(Date, "now").mockReturnValue(NOW + 61_000);
  app.observe(last);
  expect(app.store.inventory()).toBeUndefined();
});
