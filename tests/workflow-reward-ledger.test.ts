import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { reconcileRewards } from "../src/workflow-rewards.js";
import {
  homeText,
  inventoryText,
  NOW,
  statusText,
  workflowHarness,
} from "./fixtures/workflow.js";

beforeEach(() => vi.spyOn(Date, "now").mockReturnValue(NOW));
afterEach(() => vi.restoreAllMocks());

function close(app: ReturnType<typeof workflowHarness>, gold: number) {
  vi.mocked(Date.now).mockReturnValue(NOW + 60000);
  app.observe(statusText("測試熊", 900, 60, gold), "/status");
  app.observe(inventoryText(), "/inventory all");
  return app.store.capture();
}

test.each(["/skill 熊力衝擊", "/skill 合成別招", "/flee"])(
  "原生技能收益不把不同 request 的晚到回覆當成已確認收支：%s",
  (request) => {
    const fixture = JSON.parse(
      readFileSync(
        new URL("./fixtures/native-combat.json", import.meta.url),
        "utf8",
      ),
    ) as { text: string }[];
    const win = fixture.find((entry) =>
      entry.text.startsWith("✨ 使用技能：熊力衝擊"),
    );
    if (!win) {
      throw new Error("缺少既有原生勝利 fixture");
    }
    const app = workflowHarness();
    const before = app.seed();
    app.observe(win.text, request);
    const after = close(app, 7837);
    const result = reconcileRewards(app.store, before.id, after.id);
    const matched = request === "/skill 熊力衝擊";
    expect(result.data.credits).toBe(matched ? 6837 : 0);
    expect(result.data.unexplained).toBe(matched ? 0 : 6837);
    expect(result.state).toBe(matched ? "confirmed" : "needs_observation");
    expect(app.sent).toEqual([]);
  },
);

test("原生自然結算與手動尾款分開，預估查詢與他角回報不計收益", () => {
  const fixture = JSON.parse(
    readFileSync(
      new URL("./fixtures/native-idle-reports.json", import.meta.url),
      "utf8",
    ),
  ) as { natural: string; manual: string };
  const app = workflowHarness();
  const before = app.seed();
  app.observe(fixture.natural);
  app.observe(fixture.natural.replace("🍃 なるみ_風行熊", "測試熊"));
  app.observe(fixture.manual.replace("☯️ なるみ_陰陽熊", "測試熊"), "/stopidle");
  app.observe(
    fixture.natural.replace("🍃 なるみ_風行熊", "測試熊"),
    "/idlestatus",
  );
  const after = close(app, 1000 + 112259 + 33808);
  const result = reconcileRewards(app.store, before.id, after.id);
  expect(result.data.credits).toBe(146067);
  expect(result.data.unexplained).toBe(0);
  expect(result.data.netGoldPerMinute).toBe(0);
  expect(result.data.events).toEqual([
    expect.objectContaining({ category: "idle_natural", credit: 112259 }),
    expect.objectContaining({ category: "idle_manual", credit: 33808 }),
  ]);
  expect(app.sent).toEqual([]);
});

test.each([
  "尚未獲得金幣：100G",
  "世界王分寶資格預告\n獲得金幣：100G",
  "獲得金幣：100G\n未知收益尾文",
  "獲得金幣：100G\n獲得金幣：100G",
])("金幣差吻合不能取代正式完整回執：%s", (text) => {
  const app = workflowHarness();
  const before = app.seed();
  app.observe(text, "/attack 合成王");
  const after = close(app, 1100);
  const result = reconcileRewards(app.store, before.id, after.id);
  expect(result.data.credits).toBe(0);
  expect(result.data.unexplained).toBe(100);
  expect(result.state).toBe("needs_observation");
  expect(app.sent).toEqual([]);
});

test.each(["/look", "/help", undefined])(
  "孤立或無關查詢的數字標籤不被升格為收益回執：%s",
  (request) => {
    const app = workflowHarness();
    const before = app.seed();
    app.observe("獲得金幣：100G", request);
    const after = close(app, 1100);
    const result = reconcileRewards(app.store, before.id, after.id);
    expect(result.data.credits).toBe(0);
    expect(result.data.unexplained).toBe(100);
    expect(result.state).toBe("needs_observation");
  },
);

test("工藝基價／矛盾稅費不能當成已確認完整支出", () => {
  for (const text of [
    "消耗金幣：100G",
    "實際費用：100G\n消耗金幣：100G\n稅費：20G",
  ]) {
    const app = workflowHarness();
    const before = app.seed();
    app.observe(text, "/craft A1 confirm");
    const after = close(app, 900);
    const result = reconcileRewards(app.store, before.id, after.id);
    expect(result.data.debits).toBe(0);
    expect(result.data.unexplained).toBe(-100);
    expect(result.state).toBe("needs_observation");
    expect(app.sent).toEqual([]);
    vi.mocked(Date.now).mockReturnValue(NOW);
  }
});

test.each([
  "實際費用：100G",
  "消耗金幣：80G\n稅費：20G",
  "實際支出：100G\n消耗金幣：80G\n稅費：20G",
])("完整標籤式工藝支出不重算稅費，也不冒稱 native 格式：%s", (text) => {
  const app = workflowHarness();
  const before = app.seed();
  app.observe(text, "/craft A1 confirm");
  const after = close(app, 900);
  const result = reconcileRewards(app.store, before.id, after.id);
  expect(result.data.debits).toBe(100);
  expect(result.data.unexplained).toBe(0);
  expect(result.data.events).toEqual([
    expect.objectContaining({
      debit: 100,
      category: "upgrade",
      format: "labelled_replay",
    }),
  ]);
  expect(result.state).toBe("confirmed");
  expect(app.sent).toEqual([]);
});

test.each([
  "消耗金幣：9007199254740991G\n稅費：1G",
  "實際費用：100G\n稅費：101G",
  "實際費用：100G\n總支出：100G",
])("重複、超大或自相矛盾的工藝欄位維持待歸因：%s", (text) => {
  const app = workflowHarness();
  const before = app.seed();
  app.observe(text, "/craft A1 confirm");
  const after = close(app, 900);
  const result = reconcileRewards(app.store, before.id, after.id);
  expect(result.data.debits).toBe(0);
  expect(result.data.unexplained).toBe(-100);
  expect(result.state).toBe("needs_observation");
});

test.each([
  ["尚未存款成功：900G\n手續費：3G", "/deposit 900"],
  ["存款成功：900G\n手續費：3G\n未知額外扣款", "/deposit 900"],
  ["存款成功：900G\n手續費：3G\n手續費：3G", "/deposit 900"],
  ["存款成功：900G\n手續費：3G", "/deposit 901"],
  ["存款成功：900G\n手續費：3G", "/depositXYZ 900"],
  ["存款成功：900G\n手續費：3G", undefined],
  ["存款成功：900G\n手續費：3G", "/help"],
])("存款局部數字或無綁定不能確認手續費：%s（%s）", (text, request) => {
  const app = workflowHarness();
  const before = app.seed();
  app.observe(text, request);
  vi.mocked(Date.now).mockReturnValue(NOW + 60000);
  app.observe(statusText("測試熊", 900, 60, 97), "/status");
  app.observe(homeText(97, 900), "/home");
  app.observe(inventoryText(), "/inventory all");
  const after = app.store.capture();
  const result = reconcileRewards(app.store, before.id, after.id);
  expect(result.data.debits).toBe(0);
  expect(result.data.events).toEqual([]);
  expect(result.state).toBe("needs_observation");
  expect(app.sent).toEqual([]);
});

test("未證實的收益不抹除其他完整回執", () => {
  const app = workflowHarness();
  const before = app.seed();
  app.observe("尚未獲得金幣：100G", "/attack 合成王");
  app.observe("獲得金幣：20G", "/attack 合成王");
  const after = close(app, 1120);
  const result = reconcileRewards(app.store, before.id, after.id);
  expect(result.data.credits).toBe(20);
  expect(result.data.unexplained).toBe(100);
  expect(result.data.events).toHaveLength(1);
});

test("帳本保留獨立邊界與單一修訂事件，不重複入帳或按王名猜分類", () => {
  const app = workflowHarness();
  const before = app.seed();
  const receipt = app.observe("獲得金幣：100G", "/attack 合成王");
  app.store.observe([receipt]);
  const revised = { ...receipt, revision: "revised", text: "獲得金幣：120G" };
  app.store.observe([revised], "/attack 合成王");
  const after = close(app, 1120);
  const result = reconcileRewards(app.store, before.id, after.id);
  expect(result.data.ledger).toMatchObject({
    character: "測試熊",
    actualDelta: 120,
    pendingAttribution: 0,
    interval: { beforeId: before.id, afterId: after.id },
    boundaries: {
      before: { status: { gold: 1000 } },
      after: { status: { gold: 1120 } },
    },
    confirmedTransactions: [
      {
        credit: 120,
        character: "測試熊",
        source: { messageId: receipt.id, revision: "revised" },
        encounter: { type: "unknown" },
        classificationComplete: false,
      },
    ],
  });
  expect(
    (result.data.ledger as { confirmedTransactions: unknown[] })
      .confirmedTransactions,
  ).toHaveLength(1);
  expect(app.sent).toEqual([]);
});

test("已確認收支不被未知事件抹除；差額吻合也不補世界獎勵證據", () => {
  const app = workflowHarness();
  const before = app.seed();
  app.observe("首達獲得金幣：100G", "/quest");
  app.observe("世界王分寶資格已取得，等待正式殞落");
  const after = close(app, 1150);
  const result = reconcileRewards(app.store, before.id, after.id);
  expect(result.data.ledger).toMatchObject({
    actualDelta: 150,
    pendingAttribution: 50,
    confirmedTransactions: [{ category: "one_time", credit: 100 }],
  });
  expect(result.state).toBe("needs_observation");
  expect(
    (result.data.ledger as { evidenceMissing: unknown[] }).evidenceMissing
      .length,
  ).toBeGreaterThan(0);
  expect(app.sent).toEqual([]);
});

test("無關裝備重名只阻擋該品項，不抹除唯一材料的實際差額", () => {
  const app = workflowHarness();
  app.seed();
  const text = inventoryText().replace("傳世青銅巨劍", "傳世鋼鐵巨劍");
  app.observe(text, "/inventory all");
  const before = app.store.capture();
  app.observe(text.replace("x5", "x8"), "/inventory all");
  const after = app.store.capture();
  const result = reconcileRewards(app.store, before.id, after.id);
  expect(result.data.ambiguousItems).toEqual(["🟠⚔️傳世鋼鐵巨劍"]);
  expect(result.data.items).toEqual([
    { name: "王之精魄", before: 5, after: 8, delta: 3 },
  ]);
  expect(result.state).toBe("needs_observation");
  expect(app.sent).toEqual([]);
});

test("其他角色回報不合併可用預算；重設分支後不可讀取舊帳本邊界", () => {
  const app = workflowHarness();
  const before = app.seed();
  app.observe("【乙熊】\n🐾 掛機 1 小時，金幣 +999G");
  const after = close(app, 1000);
  const result = reconcileRewards(app.store, before.id, after.id);
  expect(result.data.credits).toBe(0);
  expect(
    (result.data.ledger as { confirmedTransactions: unknown[] })
      .confirmedTransactions,
  ).toEqual([]);
  app.store.reset();
  expect(() => reconcileRewards(app.store, before.id, after.id)).toThrow(
    "快照",
  );
});
