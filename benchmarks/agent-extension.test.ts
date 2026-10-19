import { rm } from "node:fs/promises";
import { basename, dirname } from "node:path";
import { performance } from "node:perf_hooks";
import { encode } from "gpt-tokenizer/encoding/o200k_base";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { WorkflowResult } from "../src/workflow-result.js";
import {
  workflowHarness as modernHarness,
  NOW,
  skillsText,
  statusText,
  towerText,
} from "../tests/fixtures/workflow.js";
import { workflowHarness as legacyHarness } from "./.baseline/tests/fixtures/workflow.js";

type App = ReturnType<typeof legacyHarness> | ReturnType<typeof modernHarness>;
const weights = { attack: 1, defense: 1, intelligence: 1, agility: 1 };
const overflow = new Set<string>();
beforeEach(() => {
  vi.spyOn(Date, "now").mockReturnValue(NOW);
  vi.spyOn(globalThis, "fetch").mockRejectedValue(
    new Error("benchmark 禁止網路"),
  );
});
afterEach(async () => {
  vi.restoreAllMocks();
  for (const path of overflow) {
    await rm(path, { recursive: true, force: true });
  }
  overflow.clear();
});

function cleanupOutput(text: string) {
  let path: unknown;
  try {
    path = JSON.parse(text).fullOutputPath;
  } catch {
    path = /Full private game output: (.+\/result\.json)\./u.exec(text)?.[1];
  }
  if (
    typeof path === "string" &&
    basename(path) === "result.json" &&
    basename(dirname(path)).startsWith("bear-of-bears-")
  ) {
    overflow.add(dirname(path));
  }
}

function client(app: App) {
  const outputs: unknown[] = [];
  let workflowCalls = 0,
    directCalls = 0;
  // 包住真實註冊函式，僅收集本測試建立的 overflow 路徑以清理。
  for (const definition of app.tools.values()) {
    const execute = definition.execute;
    definition.execute = async (...args) => {
      const output = await execute(...args);
      for (const block of output.content) {
        if (block.type === "text") {
          cleanupOutput(block.text);
        }
      }
      return output;
    };
  }
  return {
    outputs,
    counts: () => ({ workflowCalls, directCalls }),
    async call(name: string, args: unknown) {
      workflowCalls++;
      const result = await app.call(name, args);
      outputs.push(result);
      return result as WorkflowResult;
    },
    direct(name: string, args: unknown) {
      directCalls++;
      return app.context.executeTool(name, args);
    },
  };
}
type Client = ReturnType<typeof client>;

// 310列是依本輪實測規模固定的合成 workload，不複製私人完整背包。
function largeInventory() {
  const worn = [
    ["⚔️傳世鋼鐵巨劍", "ATK +5"],
    ["🛡️傳世鋼鐵護甲", "DEF +6"],
    ["⛑️傳世鋼鐵頭盔", "DEF +3"],
    ["💍傳世鋼鐵星環", "INT +1 ATK +1 DEF +1"],
    ["🥾傳世鋼鐵戰靴", "AGI +2 DEF +1"],
    ["🧤傳世鋼鐵護手", "ATK +1 DEF +1"],
  ];
  return `🎒 背包（310 種，全列）：\n${Array.from(
    { length: 309 },
    (_, index) => {
      const item = worn[index];
      return `  ${index + 1}. 🟠${item?.[0] ?? "⚔️傳世鋼鐵巨劍"} x${index + 1}${item ? " 【裝備中】" : ""} — ${item?.[1] ?? "ATK +5"}（Lv1 可裝備）`;
    },
  ).join(
    "\n",
  )}\n  310. 王之精魄 x5 — 從 BOSS 凝聚而出的力量結晶，於鍛造台用來進階王裝（/forge）。\n🔢 用編號最方便：/inspect 1`;
}

async function inventoryCase(app: App, c: Client, modern: boolean) {
  const lines = largeInventory().split("\n");
  const pages = [
    lines.slice(0, 81).join("\n"),
    lines.slice(81, 161).join("\n"),
    lines.slice(161, 241).join("\n"),
    lines.slice(241).join("\n"),
  ];
  app.overrides.set("/inventory all", () => pages.slice(0, 2));
  await c.direct("bears_inventory", { all: true });
  const partial = await c.call(
    modern ? "bears_inventory_snapshot" : "bears_combat_snapshot",
    modern ? { kind: "materials" } : { mode: "tower" },
  );
  const partialView = modern
    ? partial.data
    : (partial.data.inventory as { complete: boolean; listed: number });
  expect(modern ? partialView.sourceComplete : partialView.complete).toBe(
    false,
  );
  app.onHistory(() => {
    for (const page of pages.slice(2)) {
      app.observe(page);
    }
  });
  await c.direct("bears_history", { limit: 30 });
  const full = await c.call(
    modern ? "bears_inventory_snapshot" : "bears_combat_snapshot",
    modern ? { kind: "materials" } : { mode: "tower" },
  );
  if (modern) {
    expect(full.data).toMatchObject({
      sourceComplete: true,
      acquiredRows: 310,
      matchedRows: 1,
      actionable: false,
    });
  } else {
    expect(full.data.inventory).toMatchObject({ complete: true, listed: 310 });
  }
  return {
    rows: 310,
    initialMissing: true,
    completeAfterHistory: true,
    filteredView: modern,
  };
}

async function equipCase(app: App, c: Client, modern: boolean) {
  const point = app.store.capture();
  const result = await c.call("bears_equip_upgrade", {
    scope: app.scope(point.id),
    weights,
  });
  expect(result.state).toBe("confirmed");
  expect(app.sent.filter((command) => command.startsWith("/equip "))).toEqual([
    "/equip 2",
  ]);
  expect(app.sent.lastIndexOf("/inventory all")).toBeGreaterThan(
    app.sent.indexOf("/equip 2"),
  );
  const evaluation = result.data.evaluation as { itemReferences?: unknown[] };
  if (modern) {
    expect(evaluation.itemReferences?.length).toBeGreaterThan(0);
  }
  return {
    confirmed: true,
    postInventory: true,
    itemReferences: Boolean(evaluation.itemReferences?.length),
  };
}

async function forgeCase(app: App, c: Client, modern: boolean) {
  const quote = (stage: string, total: number, index: number) =>
    `${index}. 傳世鋼鐵巨劍\n階段：${stage}\n含稅總額：${total}G\n精魄：4\n材料需求完整\n進階後屬性：ATK +20 DEF +1 INT +0 AGI +0`;
  app.observe(
    `${quote("base → ·極", 150, 1)}\n${quote("·極 → ·神", 600, 2)}`,
    "/forge",
  );
  const result = await c.call("bears_plan_upgrade", {
    target: "傳世鋼鐵巨劍",
    metric: "attributes",
    weights,
  });
  if (modern) {
    expect(result.data.quotePaths).toEqual([
      expect.objectContaining({
        conditionalQuoteTotalGold: 750,
        totalGold: null,
        canPay: false,
        materials: [{ name: "王之精魄", quantity: 8, held: 5, missing: 3 }],
      }),
    ]);
  }
  expect(
    (result.data.candidates as { canPay: boolean }[]).every(
      (item) => !item.canPay,
    ),
  ).toBe(true);
  return {
    noPayment: true,
    combinedMaterialDeficit: modern ? 3 : null,
    multiStageQuote: Boolean(result.data.quotePaths),
  };
}

async function combatCase(app: App, c: Client, modern: boolean) {
  const raw =
    "戰鬥紀錄：合成星主\n先機：58；HP：900→842/1000\n恢復：500；HP：842→1000/1000\n燃血：100；HP：1000→900/1000\n對敵傷害：900；敵HP：900→0/1000\n狀態：戰鬥中";
  const record = app.observe(raw, "/skill 合成小招");
  app.observe(statusText(), "/status");
  app.observe(largeInventory(), "/inventory all");
  app.observe(skillsText, "/skills");
  app.observe(towerText(30, 0), "/tower");
  // 舊 API 沒有事件資料，固定 client 保留原文，不自行發明新 parser。
  if (!modern) {
    c.outputs.push({
      combatRaw: raw,
      source: {
        messageId: record.id,
        revision: record.revision,
        date: record.date,
      },
    });
  }
  const result = await c.call(
    "bears_combat_snapshot",
    modern ? { mode: "tower", view: "summary" } : { mode: "tower" },
  );
  if (modern) {
    expect(result.data.recentCombat).toMatchObject({
      complete: true,
      outcome: "ongoing",
      battleId: null,
      rewardGold: { value: null },
    });
  }
  expect(result.data.riskVerified).toBe(false);
  return {
    riskVerified: false,
    enemyHpZeroNotReward: modern ? true : null,
    orderedEvents: Boolean(result.data.recentCombat),
  };
}

async function entryCase(app: App, c: Client, modern: boolean) {
  app.overrides.set(
    "/tower",
    () => `🗼 無盡星塔 — 每一層都是一顆未墜之星的倒影
📜 個人最佳：第 58 層｜入塔 10 次
🎫 入場：🎁 今日首戰免費
🚪 /tower go 開始挑戰（自第 53 層起）——需站在 🗼星塔前庭
　⏫ 想略過低樓？/tower go 59（可指定第 1～59 層起，直達你的挑戰前線）`,
  );
  const result = await c.call("bears_tower_entry_check", {
    character: "測試熊",
    floor: 59,
    freeOnly: true,
  });
  if (modern) {
    expect(result).toMatchObject({ state: "ready", blockers: [] });
  }
  expect(
    app.sent.every((command) => command === "/status" || command === "/tower"),
  ).toBe(true);
  return {
    noEntry: true,
    nativeEligible: result.data.eligible === true,
    state: result.state,
  };
}

async function interruptionCase(app: App, c: Client) {
  const point = app.store.capture();
  app.overrides.set("/equip 2", () => "");
  const unknown = await c.call("bears_equip_upgrade", {
    scope: app.scope(point.id),
    weights,
  });
  expect(unknown.state).toBe("outcome_unknown");
  app.store.reset();
  app.observe(statusText("別的熊"), "/status");
  const stale = await c.call("bears_equip_upgrade", {
    scope: app.scope(point.id),
    weights,
  });
  expect(stale.state).toBe("stopped");
  expect(app.sent.filter((command) => command === "/equip 2")).toHaveLength(1);
  return { unknownNotResent: true, staleRejected: true, staleRejections: 1 };
}

const cases = {
  inventory: inventoryCase,
  equip: equipCase,
  forge: forgeCase,
  combat: combatCase,
  entry: entryCase,
  interruption: interruptionCase,
};
const stable = (value: unknown) =>
  JSON.stringify(value)
    .replaceAll(
      /[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/gu,
      "00000000-0000-4000-8000-000000000000",
    )
    .replaceAll(
      /[a-f0-9]{64}/gu,
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );

async function measure(name: keyof typeof cases, modern: boolean) {
  const app = modern ? modernHarness() : legacyHarness();
  app.seed();
  const c = client(app);
  const start = performance.now();
  const capabilities = await cases[name](app, c, modern);
  const durationMs = performance.now() - start;
  const mutations = app.sent.filter(
    (command) =>
      !/^\/(?:status|tower$|look|home|inventory|skills|inspect)/u.test(command),
  );
  const allowed =
    name === "equip" || name === "interruption" ? ["/equip 2"] : [];
  const wrongSideEffects = mutations.filter(
    (command, index) => command !== allowed[index],
  ).length;
  expect(wrongSideEffects).toBe(0);
  expect(mutations).toEqual(allowed);
  const visible = stable(c.outputs);
  return {
    ...c.counts(),
    gameCommands: app.sent.length,
    historyReads: app.events.filter((event) => event.tool === "bears_history")
      .length,
    originalReads: app.events.filter((event) => event.tool === "bears_original")
      .length,
    bytes: Buffer.byteLength(visible),
    tokens: encode(visible).length,
    unknownResults: c.outputs.filter(
      (value) => (value as { state?: string }).state === "outcome_unknown",
    ).length,
    invalidSnapshotRejections: c.outputs.filter((value) => {
      const result = value as Partial<WorkflowResult>;
      return (
        result.state === "stopped" &&
        result.blockers?.some((reason) =>
          /快照不存在|快照已失效|分支或角色/u.test(reason),
        )
      );
    }).length,
    wrongSideEffects,
    durationMs: Math.round(durationMs * 100) / 100,
    capabilities,
  };
}

test("固定 Git baseline 與目前程式的六案例對照；能力差異、模擬指令與輸出分開記錄", async () => {
  const report = [];
  for (const name of Object.keys(cases) as (keyof typeof cases)[]) {
    const before = await measure(name, false),
      after = await measure(name, true);
    expect(after.gameCommands).toBeLessThanOrEqual(before.gameCommands);
    expect(after.historyReads).toBeLessThanOrEqual(before.historyReads);
    report.push({ name, before, after });
  }
  expect(globalThis.fetch).not.toHaveBeenCalled();
  process.stdout.write(
    `simulated-benchmark-ms ${JSON.stringify(report.map(({ name, before, after }) => ({ name, before: before.durationMs, after: after.durationMs })))}\n`,
  );
  expect(report).toMatchSnapshot(
    report.map(() => ({
      before: { durationMs: expect.any(Number) },
      after: { durationMs: expect.any(Number) },
    })),
  );
}, 30000);
