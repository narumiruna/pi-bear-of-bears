import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { homeFacts } from "../src/workflow-parsers.js";
import { reconcileRewards } from "../src/workflow-rewards.js";
import {
  homeText,
  inventoryText,
  NOW,
  roomText,
  statusText,
  workflowHarness,
} from "./fixtures/workflow.js";

beforeEach(() => vi.spyOn(Date, "now").mockReturnValue(NOW));
afterEach(() => vi.restoreAllMocks());

test.each([
  "其餘費用：100G",
  "世界王資格預告\n獲得金幣：100G",
  "存款手續費：99G",
  "身上金幣：9999",
  "金庫餘額：9999",
  "🚪 出口：北",
])("局部家園可研究，但未知尾文或重複餘額不能保留可信狀態：%s", (tail) => {
  const app = workflowHarness();
  const point = app.seed();
  const mixed = app.observe(`${homeText()}\n${tail}`, "/home");
  expect(homeFacts(mixed.text)).toBeDefined();
  expect(app.store.status()).toBeUndefined();
  expect(app.store.inventory()).toBeUndefined();
  expect(app.store.invalidationEvent()).toMatchObject({
    kind: "unknown_bot_reply",
    messageId: mixed.id,
  });
  expect(() => app.store.assertCurrent(point.id, "測試熊")).toThrow();
  expect(app.sent).toEqual([]);
});

test("既有完整原生家園仍保留餘額，擴屋費用不成為存款費用", () => {
  const fixture = JSON.parse(
    readFileSync(
      new URL("./fixtures/native-home.json", import.meta.url),
      "utf8",
    ),
  ) as { text: string };
  const app = workflowHarness();
  app.seed();
  const reply = app.observe(fixture.text, "/home");
  expect(app.store.latest((message) => homeFacts(message.text))).toMatchObject({
    value: { cash: 1234567, vault: 0, fee: null, canDeposit: false },
    source: { messageId: reply.id },
  });
  expect(app.sent).toEqual([]);
});

test.each(["身上金幣：1,234,567", "金庫餘額：0", "🪑 未保存格式的家具列表"])(
  "原生家園混入重複來源或未知家具不放寬：%s",
  (tail) => {
    const fixture = JSON.parse(
      readFileSync(
        new URL("./fixtures/native-home.json", import.meta.url),
        "utf8",
      ),
    ) as { text: string };
    const app = workflowHarness();
    app.seed();
    app.observe(`${fixture.text}\n${tail}`, "/home");
    expect(app.store.status()).toBeUndefined();
    expect(app.store.invalidationEvent()?.kind).toBe("unknown_bot_reply");
    expect(app.sent).toEqual([]);
  },
);

test("房間名稱也叫家園時，依房間標題保留 /look，不誤套家園面板格式", () => {
  const app = workflowHarness();
  app.seed();
  app.observe(roomText("熊熊溫暖的家"), "/look");
  expect(app.store.status()?.value.name).toBe("測試熊");
  expect(app.store.invalidationEvent()).toBeNull();
  expect(app.sent).toEqual([]);
});

test("明示費用未知的既有 replay 仍保留現金，不補零", () => {
  const app = workflowHarness();
  app.seed();
  app.observe(homeText(1000, 0, "未知"), "/home");
  expect(
    app.store.latest((message) => homeFacts(message.text))?.value.fee,
  ).toBeNull();
  expect(app.sent).toEqual([]);
});

test("未知家園尾文不能在帳本中再次靠局部 parser 消失，即使淨差為零", () => {
  const app = workflowHarness();
  const before = app.seed();
  app.observe(`${homeText()}\n未支援的收支尾文`, "/home");
  vi.mocked(Date.now).mockReturnValue(NOW + 60000);
  app.observe(statusText(), "/status");
  app.observe(inventoryText(), "/inventory all");
  const after = app.store.capture();
  const result = reconcileRewards(app.store, before.id, after.id);
  expect(result.data.actualDelta).toBe(0);
  expect(result.state).toBe("needs_observation");
  expect(result.data.netGoldPerMinute).toBeNull();
  expect(app.sent).toEqual([]);
});

test("未知家園費用必須在存款 dispatch 前停止，不以事後餘額核驗取代", async () => {
  const app = workflowHarness();
  app.state.location = "熊熊溫暖的家";
  const point = app.seed();
  app.overrides.set(
    "/home",
    () => `${homeText(app.state.gold, app.state.vault)}\n其餘費用：100G`,
  );
  const result = await app.call("bears_balance_wallet", {
    scope: app.scope(point.id),
    policy: { thresholdPercent: 20, targetPercent: 10, maxDeposit: 900 },
  });
  expect(result.state).not.toBe("confirmed");
  expect(app.sent.some((command) => command.startsWith("/deposit"))).toBe(
    false,
  );
  expect(app.state.gold).toBe(1000);
  expect(app.state.vault).toBe(0);
});
