import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { inventoryText, NOW, workflowHarness } from "./fixtures/workflow.js";

beforeEach(() => vi.spyOn(Date, "now").mockReturnValue(NOW));
afterEach(() => vi.restoreAllMocks());
const options = {
  target: "傳世鋼鐵巨劍",
  metric: "attributes",
  weights: { attack: 1, defense: 1, intelligence: 1, agility: 1 },
};
const preview = (
  total = "含稅總額：150G",
  stats = "ATK +20 DEF +1 INT +0 AGI +0",
) =>
  `1. 傳世鋼鐵巨劍\n階段：base → ·極\n報價：100G\n${total}\n精魄：8\n材料需求完整\n進階後屬性：${stats}`;

function setRecipes(
  app: ReturnType<typeof workflowHarness>,
  recipes: Record<string, unknown>[],
) {
  app.codex.lookup.mockResolvedValue({
    source: "public fixture",
    fetchedAt: new Date(NOW).toISOString(),
    entries: recipes as never[],
    nextOffset: null,
    total: recipes.length,
    offset: 0,
    evolution: [],
  });
}

test("強化研究比較完整成本、材料缺口及已列屬性差異，不付款", async () => {
  const app = workflowHarness();
  app.seed();
  app.observe(preview(), "/forge preview 1");
  const result = await app.call("bears_plan_upgrade", options);
  expect(result.state).toBe("ready");
  expect(result.data.candidates).toEqual([
    expect.objectContaining({
      kind: "forge",
      quotedGold: 100,
      tax: null,
      feeDifference: 50,
      totalGold: 150,
      delta: 16,
      stage: "base → ·極",
      canPay: false,
      materials: [{ name: "王之精魄", quantity: 8, held: 5, missing: 3 }],
    }),
  ]);
  expect(app.sent).toEqual([]);
  expect(app.codex.lookup).toHaveBeenCalledOnce();
});

test.each([
  "missing_tax",
  "conflicting_tax",
  "missing_stats",
  "metric",
  "effects",
])("研究 %s 缺口不偽造完整投入或收益", async (kind) => {
  const app = workflowHarness();
  app.seed();
  let text = preview();
  if (kind === "missing_tax") {
    text = preview("");
  }
  if (kind === "conflicting_tax") {
    text = preview("含稅總額：50G");
  }
  if (kind === "missing_stats") {
    text = preview("含稅總額：150G", "ATK +20");
  }
  if (kind === "effects") {
    text += "\n被動：吸血5%";
  }
  app.observe(text, "/refine");
  const result = await app.call("bears_plan_upgrade", {
    ...options,
    metric: kind === "metric" ? "equipped_power" : "attributes",
  });
  const candidates = result.data.candidates as {
    issues: string[];
    canPay: boolean;
    delta: number | null;
  }[];
  expect(candidates[0].issues.length).toBeGreaterThan(0);
  expect(candidates[0].canPay).toBe(false);
  if (kind === "missing_stats" || kind === "metric") {
    expect(candidates[0].delta).toBeNull();
  }
  expect(app.sent).toEqual([]);
});

test("公開多階配方：逐候選扣除共享材料，缺口及階段報價不重複使用存量", async () => {
  const app = workflowHarness();
  app.seed();
  setRecipes(app, [
    {
      out_name: "融合核心",
      materials: [
        { name: "中間核心", qty: 2 },
        { name: "王之精魄", qty: 4 },
      ],
      essence: 0,
      gold: 1000,
      out_stats: "INT+720",
      out_passive: "未知",
    },
    {
      out_name: "中間核心",
      materials: [{ name: "王之精魄", qty: 3 }],
      essence: 0,
      gold: 100,
      out_stats: "INT+100",
      out_passive: "",
    },
  ]);
  const result = await app.call("bears_plan_upgrade", {
    ...options,
    target: "融合核心",
  });
  const candidates = result.data.candidates as {
    missing: unknown;
    stages: unknown;
    quotedStageGold: number;
    totalGold: null;
  }[];
  expect(candidates[0].missing).toEqual([{ name: "王之精魄", quantity: 5 }]);
  expect(candidates[0].quotedStageGold).toBe(1200);
  expect(candidates[0].totalGold).toBeNull();
  expect(candidates[0].stages).toHaveLength(2);
  expect(app.sent).toEqual([]);
});

test("配方循環、消耗現裝及缺精魄資料均有候選級 blocker，不執行銷毀", async () => {
  const app = workflowHarness();
  app.seed();
  setRecipes(app, [
    {
      out_name: "循環核心",
      materials: [
        { name: "循環核心", qty: 1 },
        { name: "傳世鋼鐵巨劍", qty: 1 },
      ],
      gold: 100,
    },
  ]);
  const result = await app.call("bears_plan_upgrade", {
    ...options,
    target: "循環核心",
  });
  const issues = (
    result.data.candidates as { issues: string[] }[]
  )[0].issues.join(" ");
  expect(issues).toContain("循環");
  expect(issues).toContain("目前所需");
  expect(issues).toContain("缺漏");
  expect(app.sent).toEqual([]);
});

test("公開來源失敗只阻擋相依候選，仍保留本人已核對的進化候選", async () => {
  const app = workflowHarness();
  app.seed();
  app.observe(preview(), "/forge preview 1");
  app.codex.lookup.mockRejectedValue(new Error("HTTP 503"));
  const result = await app.call("bears_plan_upgrade", options);
  expect(result.state).toBe("needs_observation");
  expect(result.data.candidates).toHaveLength(1);
  expect(result.blockers.join(" ")).toContain("503");
  expect(app.sent).toEqual([]);
});

test("不完整背包、未知本人持有與基值／有效值衝突不產生付款建議", async () => {
  const app = workflowHarness();
  app.seed();
  app.observe(
    inventoryText().replace("背包（3 種，全列）", "背包（4 種，全列）"),
    "/inventory all",
  );
  const result = await app.call("bears_plan_upgrade", options);
  expect(result.state).toBe("needs_observation");
  expect(app.codex.lookup).not.toHaveBeenCalled();
});

test("進化比較採精煉有效屬性，不用基值誇大提升", async () => {
  const app = workflowHarness();
  app.seed();
  app.observe(
    inventoryText().replace(
      "傳世鋼鐵巨劍 【裝備中】",
      "傳世鋼鐵巨劍 ✨+1（ATK 5→6） 【裝備中】",
    ),
    "/inventory all",
  );
  app.observe(preview(), "/forge preview 1");
  const result = await app.call("bears_plan_upgrade", options);
  expect((result.data.candidates as { delta: number }[])[0].delta).toBe(15);
});

test("同候選的共享材料先合併需求，不分別重用同一份存量", async () => {
  const app = workflowHarness();
  app.seed();
  app.observe(`${preview()}\n材料：王之精魄 ×4`, "/forge preview 1");
  const result = await app.call("bears_plan_upgrade", options);
  expect(
    (result.data.candidates as { materials: unknown }[])[0].materials,
  ).toEqual([{ name: "王之精魄", quantity: 12, held: 5, missing: 7 }]);
});

test("公開配方跨頁取得相同快照的子配方，游標錯誤不重試或空轉", async () => {
  const app = workflowHarness();
  app.seed();
  const source = {
    source: "public fixture",
    fetchedAt: new Date(NOW).toISOString(),
    total: 11,
    offset: 0,
    evolution: [],
  };
  const parent = {
    out_name: "融合核心",
    materials: [{ name: "中間核心", qty: 2 }],
    gold: 1000,
    essence: 0,
  };
  const child = {
    out_name: "中間核心",
    materials: [{ name: "王之精魄", qty: 3 }],
    gold: 100,
    essence: 0,
  };
  app.codex.lookup.mockResolvedValueOnce({
    ...source,
    entries: [
      parent,
      ...Array.from({ length: 9 }, (_, index) => ({
        out_name: `其他核心${index}`,
        materials: [],
        gold: 0,
        essence: 0,
      })),
    ] as never[],
    nextOffset: 10,
  } as never);
  app.codex.lookup.mockResolvedValueOnce({
    ...source,
    entries: [child] as never[],
    nextOffset: null,
  });
  const result = await app.call("bears_plan_upgrade", {
    ...options,
    target: "融合核心",
  });
  expect((result.data.candidates as { missing: unknown }[])[0].missing).toEqual(
    [{ name: "王之精魄", quantity: 1 }],
  );
  expect(app.codex.lookup).toHaveBeenCalledTimes(2);
  expect(app.codex.lookup.mock.calls[1][0]).toEqual({
    recipes: true,
    offset: 10,
  });
  const invalid = workflowHarness();
  invalid.seed();
  invalid.codex.lookup.mockResolvedValue({
    ...source,
    entries: [],
    nextOffset: 0,
  } as never);
  const blocked = await invalid.call("bears_plan_upgrade", options);
  expect(blocked.blockers.join(" ")).toContain("游標");
  expect(invalid.codex.lookup).toHaveBeenCalledOnce();
});
