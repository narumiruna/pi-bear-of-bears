import { performance } from "node:perf_hooks";
import { encode } from "gpt-tokenizer/encoding/o200k_base";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { WorkflowResult } from "../src/workflow-result.js";
import {
  inventoryText,
  NOW,
  skillsText,
  statusText,
  towerText,
  workflowHarness,
} from "./fixtures/workflow.js";

beforeEach(() => vi.spyOn(Date, "now").mockReturnValue(NOW));
afterEach(() => vi.restoreAllMocks());
const weights = { attack: 1, defense: 1, intelligence: 1, agility: 1 };
type App = ReturnType<typeof workflowHarness>;

// 只量測合成 transport 與實際 workflow 回傳；不是模型／Telegram 端到端基準。
async function measure(
  name: string,
  run: (app: App, outputs: WorkflowResult[]) => Promise<void>,
) {
  const app = workflowHarness();
  app.seed();
  const outputs: WorkflowResult[] = [];
  const start = performance.now();
  await run(app, outputs);
  const milliseconds = performance.now() - start;
  // 固定 UUID 與衍生 hash，避免本機參照的隨機 epoch 改變 tokenizer 分詞。
  const visible = JSON.stringify(outputs)
    .replaceAll(
      /[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/gu,
      "00000000-0000-4000-8000-000000000000",
    )
    .replaceAll(
      /[a-f0-9]{64}/gu,
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  const sideEffects = app.sent.filter(
    (command) =>
      !/^\/(?:status|tower$|look|home|inventory|skills|inspect)/u.test(command),
  );
  // 只允許本 fixture 的單件換裝；其他副作用一律使測試失敗。
  const allowed =
    name === "equip" || name === "interruption" ? ["/equip 2"] : [];
  expect(sideEffects).toEqual(allowed);
  expect(
    app.events.filter((event) => event.tool === "bears_history").length,
  ).toBeLessThanOrEqual(name === "interruption" ? 4 : 2);
  return {
    name,
    workflowCalls: outputs.length,
    simulatedTelegramCommands: app.sent.length,
    historyReads: app.events.filter((event) => event.tool === "bears_history")
      .length,
    originalReads: 0,
    outputBytes: Buffer.byteLength(visible),
    outputTokens: encode(visible).length,
    unknownResults: outputs.filter(
      (result) => result.state === "outcome_unknown",
    ).length,
    wrongSideEffects: 0,
    milliseconds: Math.round(milliseconds * 100) / 100,
  };
}

const quote = (stage: string, total: number, index: number) =>
  `${index}. 傳世鋼鐵巨劍\n階段：${stage}\n含稅總額：${total}G\n精魄：4\n材料需求完整\n進階後屬性：ATK +20 DEF +1 INT +0 AGI +0`;

const scenarios: [
  string,
  (app: App, outputs: WorkflowResult[]) => Promise<void>,
][] = [
  [
    "late-inventory",
    async (app, outputs) => {
      const lines = inventoryText().split("\n");
      app.overrides.set("/inventory all", () => [
        lines.slice(0, 2).join("\n"),
        lines[2],
      ]);
      await app.context.executeTool("bears_inventory", { all: true });
      outputs.push(await app.call("bears_inventory_snapshot", {}));
      expect(outputs.at(-1)?.data.sourceComplete).toBe(false);
      app.onHistory(() => app.observe(lines.slice(3).join("\n")));
      await app.context.executeTool("bears_history", { limit: 30 });
      outputs.push(
        await app.call("bears_inventory_snapshot", { kind: "materials" }),
      );
      expect(outputs.at(-1)?.data.sourceComplete).toBe(true);
    },
  ],
  [
    "equip",
    async (app, outputs) => {
      const point = app.store.capture();
      outputs.push(
        await app.call("bears_equip_upgrade", {
          scope: app.scope(point.id),
          weights,
        }),
      );
      expect(outputs[0].state).toBe("confirmed");
      expect(app.sent.lastIndexOf("/inventory all")).toBeGreaterThan(
        app.sent.indexOf("/equip 2"),
      );
    },
  ],
  [
    "two-stage-forge",
    async (app, outputs) => {
      app.observe(
        `${quote("base → ·極", 150, 1)}\n${quote("·極 → ·神", 600, 2)}`,
        "/forge",
      );
      outputs.push(
        await app.call("bears_plan_upgrade", {
          target: "傳世鋼鐵巨劍",
          metric: "attributes",
          weights,
        }),
      );
      expect(outputs[0].data.quotePaths).toEqual([
        expect.objectContaining({
          conditionalQuoteTotalGold: 750,
          totalGold: null,
          canPay: false,
          materials: [{ name: "王之精魄", quantity: 8, held: 5, missing: 3 }],
        }),
      ]);
    },
  ],
  [
    "combat-replay",
    async (app, outputs) => {
      app.observe(
        "戰鬥紀錄：合成星主\n先機：58；HP：900→842/1000\n恢復：500；HP：842→1000/1000\n燃血：100；HP：1000→900/1000\n對敵傷害：900；敵HP：900→0/1000\n狀態：戰鬥中",
        "/skill 合成小招",
      );
      app.observe(statusText(), "/status");
      app.observe(inventoryText(), "/inventory all");
      app.observe(skillsText, "/skills");
      app.observe(towerText(), "/tower");
      outputs.push(await app.call("bears_combat_snapshot", { mode: "tower" }));
      expect(outputs[0].data.recentCombat).toMatchObject({
        complete: true,
        outcome: "ongoing",
        battleId: null,
        rewardGold: { value: null },
      });
      expect(outputs[0].data.riskVerified).toBe(false);
    },
  ],
  [
    "native-entry",
    async (app, outputs) => {
      // 765599 免費入口的已觀察欄位；不是新遊戲查詢。
      app.overrides.set(
        "/tower",
        () => `🗼 無盡星塔 — 每一層都是一顆未墜之星的倒影
📜 個人最佳：第 58 層｜入塔 10 次
🎫 入場：🎁 今日首戰免費
🚪 /tower go 開始挑戰（自第 53 層起）——需站在 🗼星塔前庭
　⏫ 想略過低樓？/tower go 59（可指定第 1～59 層起，直達你的挑戰前線）`,
      );
      outputs.push(
        await app.call("bears_tower_entry_check", {
          character: "測試熊",
          floor: 59,
          freeOnly: true,
        }),
      );
      expect(outputs[0].state).toBe("ready");
      expect(app.sent).toEqual(["/status", "/tower"]);
    },
  ],
  [
    "interruption",
    async (app, outputs) => {
      const point = app.store.capture();
      app.overrides.set("/equip 2", () => "");
      outputs.push(
        await app.call("bears_equip_upgrade", {
          scope: app.scope(point.id),
          weights,
        }),
      );
      expect(outputs[0].state).toBe("outcome_unknown");
      app.store.reset();
      app.observe(statusText("別的熊"), "/status");
      outputs.push(
        await app.call("bears_equip_upgrade", {
          scope: app.scope(point.id),
          weights,
        }),
      );
      expect(outputs[1].state).toBe("stopped");
      expect(app.sent.filter((command) => command === "/equip 2")).toHaveLength(
        1,
      );
    },
  ],
];

test("六案例建立目前版本的離線基準，缺舊版／真實模型量測時不宣稱改善率", async () => {
  const report = [];
  for (const [name, run] of scenarios) {
    report.push(await measure(name, run));
  }
  expect(report).toHaveLength(6);
  // 時間不作效能門檻；機器負載與 Vitest workers 會改變數值。
  expect(report).toMatchSnapshot(
    report.map(() => ({ milliseconds: expect.any(Number) })),
  );
});
