import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { STRUCTURED_COMMANDS, serializeCommand } from "../src/game-commands.js";
import { WORKFLOW_QUERY } from "../src/workflow-parsers.js";
import { inventoryText, NOW, workflowHarness } from "./fixtures/workflow.js";

beforeEach(() => vi.spyOn(Date, "now").mockReturnValue(NOW));
afterEach(() => vi.restoreAllMocks());

const entry = STRUCTURED_COMMANDS.find(
  (entry) => entry.command === "craft_make",
);
if (!entry) {
  throw new Error("缺少 craft_make tool");
}
const options = {
  target: "傳世鋼鐵巨劍",
  metric: "attributes",
  weights: { attack: 1, defense: 1, intelligence: 1, agility: 1 },
};
// #358 部署說明的離線示例，不代表完整實機預覽格式。
const preview = (materials = "傳世鋼鐵巨劍＋傳世青銅巨劍", warning = "") =>
  `合成預覽：傳世鋼鐵巨劍\n${warning}\n🔥 將永久消耗：${materials}\n精魄：8\n金幣：100G\n稅費：50G\n含稅總額：150G`;

test.each([undefined, "確定", "確定燒絕世"])(
  "合成 %s 只序列化一次，不自動接續或升級確認",
  async (confirm) => {
    const params = { recipe: "A1", ...(confirm ? { confirm } : {}) };
    const command = `/craft A1${confirm ? ` ${confirm}` : ""}`;
    expect(serializeCommand(entry, params)).toBe(command);
    const app = workflowHarness();
    app.seed();
    app.overrides.set(command, () => preview());
    await app.call("bears_craft_make", params);
    expect(app.sent).toEqual([command]);
  },
);

test.each([true, false, "", "確認", "確定 燒絕世", "確定\n/say 測試"])(
  "拒絕非法合成確認 %s 且不傳送",
  async (confirm) => {
    const app = workflowHarness();
    await expect(
      app.call("bears_craft_make", { recipe: "A1", confirm }),
    ).rejects.toThrow();
    expect(app.sent).toEqual([]);
  },
);

test.each([
  ["/craft", true],
  ["/craft A1", true],
  ["/craft E123", true],
  ["/craft A1 確定", false],
  ["/craft A1 確定燒絕世", false],
  ["/craft store 1", false],
  ["/craft take 1", false],
  ["/craft A0", false],
  ["/craft A1\n/status", false],
] as const)("查詢分類 %s = %s", (command, query) => {
  expect(WORKFLOW_QUERY.test(command)).toBe(query);
});

test("預覽保留 workflow 快照；兩種確認均使舊快照失效", () => {
  for (const confirm of ["確定", "確定燒絕世"]) {
    const app = workflowHarness();
    const point = app.seed();
    app.observe(preview(), "/craft A1");
    expect(app.store.assertCurrent(point.id, "測試熊").id).toBe(point.id);
    app.observe("合成結果不明", `/craft A1 ${confirm}`);
    expect(() => app.store.assertCurrent(point.id, "測試熊")).toThrow();
  }
});

test("單配方預覽採實際永久消耗清單，保留費用、來源與所需裝備保護", async () => {
  const app = workflowHarness();
  app.seed();
  const source = app.observe(
    `${preview()}\n材料：不應重複計數 ×99`,
    "/craft A1",
  );
  const result = await app.call("bears_plan_upgrade", options);
  expect(result.data.candidates).toEqual([
    expect.objectContaining({
      kind: "craft",
      confirmation: "確定",
      selectionVerified: false,
      canPay: false,
      quotedGold: 100,
      tax: 50,
      totalGold: 150,
      source: expect.objectContaining({ messageId: source.id }),
      consumptionRaw: ["🔥 將永久消耗：傳世鋼鐵巨劍＋傳世青銅巨劍"],
      materials: [
        { name: "傳世鋼鐵巨劍", quantity: 1, held: 1, missing: 0 },
        { name: "傳世青銅巨劍", quantity: 1, held: 1, missing: 0 },
        { name: "王之精魄", quantity: 8, held: 5, missing: 3 },
      ],
      issues: expect.arrayContaining([
        "合成會消耗目前所需或鎖定的裝備／技能材料。",
      ]),
    }),
  ]);
  expect(app.sent).toEqual([]);
});

test.each(["警告：材料含絕世神裝", "結果不明"])(
  "普通確認被擋或結果不明時不重送、不自動升級：%s",
  async (reply) => {
    const app = workflowHarness();
    app.seed();
    app.overrides.set("/craft A1 確定", () => reply);
    await app.call("bears_craft_make", { recipe: "A1", confirm: "確定" });
    expect(app.sent).toEqual(["/craft A1 確定"]);
  },
);

test.each([true, false])(
  "絕世警告或選材名稱保留 double confirm；warning=%s",
  async (warning) => {
    const app = workflowHarness();
    app.seed();
    app.observe(
      inventoryText().replaceAll("傳世青銅巨劍", "絕世焚世頭冠·神"),
      "/inventory all",
    );
    app.observe(
      preview(
        "傳世鋼鐵巨劍＋絕世焚世頭冠·神",
        warning ? "🔴🔴 警告：材料含絕世神裝\n/craft A1 確定燒絕世" : "",
      ),
      "/craft A1",
    );
    const result = await app.call("bears_plan_upgrade", options);
    expect(result.data.candidates).toEqual([
      expect.objectContaining({
        confirmation: "確定燒絕世",
        canPay: false,
        issues: expect.arrayContaining([
          "材料含絕世神裝；不得自動升級為確定燒絕世。",
        ]),
        warnings: warning
          ? ["🔴🔴 警告：材料含絕世神裝", "/craft A1 確定燒絕世"]
          : [],
      }),
    ]);
    expect(app.sent).toEqual([]);
  },
);

test.each([
  "",
  "🔥 將永久消耗：未知格式（兩件）",
  "🔥 將永久消耗：\n🔥 將永久消耗：不明物品",
])("缺漏或未知消耗格式不補齊或授權付款：%s", async (consumption) => {
  const app = workflowHarness();
  app.seed();
  app.observe(`合成預覽：傳世鋼鐵巨劍\n${consumption}`, "/craft A1");
  const result = await app.call("bears_plan_upgrade", options);
  expect(result.data.candidates).toEqual([
    expect.objectContaining({
      canPay: false,
      selectionVerified: false,
      issues: expect.arrayContaining([
        "完整含稅成本未知。",
        "完整材料／選材尚未確認。",
      ]),
    }),
  ]);
  expect(app.sent).toEqual([]);
});
