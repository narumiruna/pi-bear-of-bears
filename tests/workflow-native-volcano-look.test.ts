import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { roomFacts } from "../src/workflow-parsers.js";
import { knownQueryObservation } from "../src/workflow-query-observation.js";
import {
  message,
  NOW,
  statusText,
  workflowHarness,
} from "./fixtures/workflow.js";

// Telegram 857767，2026-10-29；只驗證房間分類，不證明移動或休息免費。
const nativeLook = `⛺ 火山營地
────────────────────
火山營地：熔岩地帶中的安全據點，可休息補給、完全恢復。

🚪 出口：北→熔流裂罅　東→蒸氣噴孔　南→幽暗裂隙　西→黑曜坡
🛍️ 商店在此，輸入 /shop 查看。`;

beforeEach(() => vi.spyOn(Date, "now").mockReturnValue(NOW));
afterEach(() => vi.restoreAllMocks());

test("歷史舊切角指令不應使其後已確認的本人狀態重新待確認", () => {
  const app = workflowHarness();
  const current = message(200, statusText("測試熊"));
  app.store.observe([current], "/status");
  app.store.observe([
    message(149, statusText("前角")),
    message(150, "/switch 測試熊", true),
    current,
  ]);
  expect(app.store.status()?.source.messageId).toBe(200);
  expect(app.sent).toEqual([]);
});

test("原生火山營地 look 可辨識房間，且不清除既有本人狀態", () => {
  expect(roomFacts(nativeLook)).toMatchObject({
    name: "火山營地",
    exits: ["北", "南", "東", "西"],
  });
  expect(knownQueryObservation(message(857767, nativeLook))).toBe(true);
  const app = workflowHarness();
  app.seed();
  const before = app.store.status();
  app.observe(nativeLook, "/look");
  expect(app.store.status()).toEqual(before);
  expect(app.sent).toEqual([]);
});
