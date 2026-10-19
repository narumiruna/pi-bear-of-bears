import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { inventoryText, NOW, workflowHarness } from "./fixtures/workflow.js";

beforeEach(() => vi.spyOn(Date, "now").mockReturnValue(NOW));
afterEach(() => vi.restoreAllMocks());
const options = {
  target: "傳世鋼鐵巨劍",
  metric: "attributes",
  weights: { attack: 1, defense: 1, intelligence: 1, agility: 1 },
};
const quote = (extra = "含稅總額：150G", stage = "base → ·極") =>
  `1. 傳世鋼鐵巨劍\n階段：${stage}\n報價：100G\n${extra}\n精魄：8\n材料需求完整\n進階後屬性：ATK +20 DEF +1 INT +0 AGI +0`;
const candidate = async (text: string, command = "/forge preview 1") => {
  const app = workflowHarness();
  app.seed();
  app.observe(text, command);
  const result = await app.call("bears_plan_upgrade", options);
  expect(app.sent).toEqual([]);
  return (result.data.candidates as Record<string, unknown>[])[0];
};

test.each([
  "含稅總額：150G\n稅費：80G",
  "含稅總額：150G\n含稅總額：150G",
  "含稅總額：150,00G",
  "含稅總額：150G\n另收未知手續費",
])("矛盾、重複、壞千分位、未知額外費不能保留完整總價：%s", async (text) => {
  const result = await candidate(quote(text));
  expect(result.totalGold).toBeNull();
  expect(result.canPay).toBe(false);
  expect(result.quote).toMatchObject({ complete: false, raw: quote(text) });
});

test("只有明列所有費用時才將基價與稅加總；不把 forge 稅套到 refine", async () => {
  const known = await candidate(quote("稅費：50G\n無其他費用"));
  expect(known).toMatchObject({
    totalGold: 150,
    quote: {
      totalBasis: "derived",
      operation: "forge",
      taxGold: 50,
      complete: true,
    },
  });
  const unknown = await candidate(quote("稅費：50G"), "/refine");
  expect(unknown).toMatchObject({
    totalGold: null,
    quote: { operation: "refine", totalBasis: "unknown", complete: false },
  });
});

test("兩階 forge 逐階扣共享材料；合計只作條件報價，跨資產級距須重核後階", async () => {
  const app = workflowHarness();
  app.seed();
  app.observe(
    `${quote("稅費：50G\n含稅總額：150G\n本人資產：1,000G\n資產級距：900～2,000G")}\n${quote("稅費：200G\n含稅總額：600G", "·極 → ·神").replace("1. ", "2. ").replace("報價：100G", "報價：400G")}`,
    "/forge",
  );
  const result = await app.call("bears_plan_upgrade", options);
  expect(result.data.quotePaths).toEqual([
    expect.objectContaining({
      conditionalQuoteTotalGold: 750,
      totalGold: null,
      canPay: false,
      revalidateAfterEveryStage: true,
      materials: [{ name: "王之精魄", quantity: 16, held: 5, missing: 11 }],
      projectedCash: [850, 250],
    }),
  ]);
  const path = (result.data.quotePaths as { issues: string[] }[])[0];
  expect(path.issues.join(" ")).toContain("資產級距");
  expect(app.sent).toEqual([]);
});

test("四軸使用精煉有效值；技能／被動另列，不用 ATK 增加宣稱全面勝出", async () => {
  const app = workflowHarness();
  app.seed();
  app.observe(
    inventoryText()
      .replace("ATK +5（Lv1 可裝備）", "ATK +5（Lv1 可裝備）")
      .replace(
        "傳世鋼鐵巨劍 【裝備中】",
        "傳世鋼鐵巨劍 ✨+1（ATK 5→6） 【裝備中】",
      ),
    "/inventory all",
  );
  app.observe(
    `${quote()}\n失去效果：真實傷害12%\n進階後被動：爆擊率18%\n自動裝備：是`,
    "/forge preview 1",
  );
  const result = await app.call("bears_plan_upgrade", options);
  const item = (result.data.candidates as Record<string, unknown>[])[0];
  expect(item.comparison).toMatchObject({
    axisDelta: { attack: 14, defense: 1, intelligence: 0, agility: 0 },
    observedLostEffects: ["真實傷害12%"],
    observedAfterEffects: ["爆擊率18%"],
    effectsVerified: false,
    universallyBetter: false,
  });
  expect(item.quote).toMatchObject({ automaticEquip: true });
  expect(item.canPay).toBe(false);
});

test.each(["另收手續費：20G", "手續費：20G"])(
  "選單共通費用不能在拆段後遺失：%s",
  async (header) => {
    const item = await candidate(
      `${header}\n${quote("稅費：50G\n含稅總額：150G")}`,
    );
    expect(item.totalGold).toBeNull();
    expect(item.quote).toMatchObject({ complete: false });
  },
);

test("較舊或其他角色報價不混入；公開查詢期間切角不交付可執行研究快照", async () => {
  const app = workflowHarness();
  app.seed();
  app.observe(quote(), "/forge preview 1");
  const original = app.codex.lookup.getMockImplementation();
  if (!original) {
    throw new Error("缺少 mock");
  }
  app.codex.lookup.mockImplementation((...args) => {
    app.store.reset();
    return original(...args);
  });
  const result = await app.call("bears_plan_upgrade", options);
  expect(result.state).toBe("stopped");
  expect(app.sent).toEqual([]);
});
