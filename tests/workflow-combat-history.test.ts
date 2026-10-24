import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { recentCombatEvents } from "../src/combat-events.js";
import {
  inventoryText,
  NOW,
  skillsText,
  statusText,
  workflowHarness,
} from "./fixtures/workflow.js";

beforeEach(() => vi.spyOn(Date, "now").mockReturnValue(NOW));
afterEach(() => vi.restoreAllMocks());

const nativeWin = (
  JSON.parse(
    readFileSync(
      new URL("./fixtures/native-combat.json", import.meta.url),
      "utf8",
    ),
  ) as { text: string }[]
).find((entry) => entry.text.startsWith("✨ 使用技能：熊力衝擊"))?.text;
if (!nativeWin) {
  throw new Error("缺少既有原生勝利 fixture");
}

test.each(["/skill 熊力衝擊", "/skill 合成別招", "/flee"])(
  "原生勝場與已用技能必須對應同筆技能 request：%s",
  async (request) => {
    const app = workflowHarness();
    app.seed();
    const receipt = app.observe(nativeWin, request);
    const result = await app.call("bears_combat_snapshot", {
      mode: "boss",
      includeHistory: true,
    });
    if (request === "/skill 熊力衝擊") {
      expect(result.data.history).toMatchObject({
        samples: [
          {
            outcome: "won",
            observedSkill: {
              name: "熊力衝擊",
              source: { messageId: receipt.id },
            },
          },
        ],
      });
    } else {
      expect(result.data.history).toMatchObject({
        samples: [],
        incompleteSources: [{ messageId: receipt.id }],
      });
      expect(recentCombatEvents(app.store, "測試熊")).toMatchObject({
        complete: false,
        outcome: "unknown",
        rewardGold: { value: null },
      });
    }
    expect(app.sent).toEqual([]);
  },
);

test("正式回執依角色及來源分開；同名王不猜型別或傷害上界", async () => {
  const app = workflowHarness();
  app.seed();
  const first = app.observe(
    "戰鬥紀錄：同名王\n對敵傷害：100；敵HP：100→0/100\n結算：勝利\n獲得金幣：10G",
    "/skill 合成招",
  );
  app.observe(statusText("乙熊"), "/status");
  app.observe("戰鬥紀錄：同名王\n結算：逃離", "/flee");
  app.observe(statusText("乙熊"), "/status");
  const result = await app.call("bears_combat_snapshot", {
    mode: "boss",
    includeHistory: true,
  });
  const history = result.data.history as {
    samples: Record<string, unknown>[];
    personalCooldown: unknown;
    actionable: boolean;
  };
  expect(history.samples).toHaveLength(2);
  expect(history.samples[0]).toMatchObject({
    character: "測試熊",
    outcome: "won",
    source: { messageId: first.id },
    target: { name: "同名王", type: "unknown" },
    riskVerified: false,
    conditionsComplete: false,
    lastObservedResources: { value: { name: "測試熊", hp: 900 } },
  });
  expect(history.samples[1]).toMatchObject({
    character: "乙熊",
    outcome: "escaped",
    target: { name: "同名王", type: "unknown" },
  });
  expect(history.personalCooldown).toMatchObject({
    eligible: null,
    state: "needs_observation",
  });
  expect(history.actionable).toBe(false);
  expect(app.sent).toEqual([]);
});

test.each(["未知資源變動", "金幣：999999"])(
  "歷史資源不重新採用已拒絕的 status：%s",
  async (tail) => {
    const app = workflowHarness();
    app.seed();
    const invalid = app.observe(
      `${statusText("測試熊", 123, 12, 456)}\n${tail}`,
      "/status",
    );
    app.observe("戰鬥紀錄：合成王\n結算：逃離", "/flee");
    app.observe(statusText(), "/status");
    const result = await app.call("bears_combat_snapshot", {
      mode: "boss",
      includeHistory: true,
    });
    const history = result.data.history as {
      samples: { lastObservedResources: { source: { messageId: number } } }[];
    };
    expect(history.samples[0].lastObservedResources.source.messageId).not.toBe(
      invalid.id,
    );
    expect(history.samples[0]).toMatchObject({
      lastObservedResources: { value: { hp: 900 } },
      conditionsComplete: false,
      riskVerified: false,
    });
    expect(app.sent).toEqual([]);
  },
);

test("歷史多頁背包重用完整性判定與每頁來源，不把 subset 當完整配裝", async () => {
  const app = workflowHarness();
  app.seed();
  const lines = inventoryText().split("\n");
  app.observe("/inventory all", undefined, true);
  const first = app.observe(lines.slice(0, 2).join("\n"), "/inventory all");
  const last = app.observe(lines.slice(2).join("\n"));
  app.observe("戰鬥紀錄：合成王\n結算：逃離", "/flee");
  const result = await app.call("bears_combat_snapshot", {
    mode: "boss",
    includeHistory: true,
  });
  expect(result.data.history).toMatchObject({
    samples: [
      {
        lastObservedEquipment: {
          equipped: [{ id: 1 }],
          sources: [{ messageId: first.id }, { messageId: last.id }],
        },
        conditionsComplete: false,
      },
    ],
  });
  expect(app.sent).toEqual([]);
});

test("只比較同角色最後觀測的資源差異，保留條件未知，不產生承傷上界", async () => {
  const app = workflowHarness();
  app.seed();
  app.observe("戰鬥紀錄：合成王\n結算：逃離", "/flee");
  app.observe(statusText("測試熊", 800, 50, 900), "/status");
  const result = await app.call("bears_combat_snapshot", {
    mode: "boss",
    includeHistory: true,
  });
  const history = result.data.history as {
    samples: { lastObservedComparison: unknown; riskVerified: boolean }[];
  };
  expect(history.samples[0]).toMatchObject({
    riskVerified: false,
    lastObservedComparison: {
      basis: "last_observations_only",
      differences: expect.arrayContaining([
        { field: "hp", before: 900, after: 800, delta: -100 },
        { field: "mp", before: 60, after: 50, delta: -10 },
      ]),
    },
  });
  expect(history.samples[0]).not.toHaveProperty("damageUpperBound");
  expect(app.sent).toEqual([]);
});

test("已勝邊界的配裝與技能比較保留兩端來源，不把欄位差異當提升", async () => {
  const app = workflowHarness();
  app.seed();
  app.observe("戰鬥紀錄：合成王\n結算：勝利\n獲得金幣：10G", "/skill 合成小招");
  app.observe(statusText(), "/status");
  const equipment = app.observe(inventoryText(2), "/inventory all");
  const skills = app.observe(skillsText.replace("12MP", "14MP"), "/skills");
  const result = await app.call("bears_combat_snapshot", {
    mode: "boss",
    includeHistory: true,
  });
  expect(result.data.history).toMatchObject({
    samples: [
      {
        outcome: "won",
        target: { name: "合成王", type: "unknown" },
        unknowns: expect.arrayContaining([
          expect.stringContaining("未知裝備變更"),
        ]),
        lastObservedConditionComparison: {
          basis: "last_observations_only",
          equipment: {
            currentSources: [{ messageId: equipment.id }],
            removed: [{ name: "🟠⚔️傳世鋼鐵巨劍" }],
            added: [{ name: "🟠⚔️傳世青銅巨劍" }],
            changed: [],
          },
          skills: {
            currentSources: [{ messageId: skills.id }],
            changed: [
              {
                name: "合成小招",
                before: { mpCost: 12 },
                after: { mpCost: 14 },
              },
            ],
            coverage: "parsed_entries_only",
          },
          conditionsComplete: false,
        },
        riskVerified: false,
      },
    ],
    actionable: false,
  });
  expect(app.sent).toEqual([]);
});

test.each(["missing", "incomplete", "other_actor", "expired"])(
  "缺少完整同角目前配裝不捏造條件比較：%s",
  async (mode) => {
    const app = workflowHarness();
    app.seed();
    app.observe("戰鬥紀錄：合成王\n結算：逃離", "/flee");
    if (mode === "other_actor") {
      app.observe(statusText("乙熊"), "/status");
    } else {
      app.observe(statusText(), "/status");
    }
    if (mode !== "missing") {
      app.observe(
        mode === "incomplete"
          ? inventoryText().split("\n").slice(0, 2).join("\n")
          : inventoryText(2),
        "/inventory all",
      );
    }
    if (mode === "expired") {
      vi.mocked(Date.now).mockReturnValue(NOW + 300001);
      app.observe(statusText(), "/status");
    }
    const result = await app.call("bears_combat_snapshot", {
      mode: "boss",
      includeHistory: true,
    });
    const history = result.data.history as {
      samples: {
        lastObservedConditionComparison: { equipment: unknown } | null;
      }[];
    };
    const comparison = history.samples[0].lastObservedConditionComparison;
    if (mode === "other_actor") {
      expect(comparison).toBeNull();
    } else {
      expect(comparison).toMatchObject({
        equipment: null,
        missingBlocks: expect.arrayContaining(["equipment"]),
        conditionsComplete: false,
      });
    }
    expect(app.sent).toEqual([]);
  },
);

test("背包重編號不產生配裝差異，未知效果描述的變動不補零", async () => {
  const app = workflowHarness();
  app.seed();
  app.observe("戰鬥紀錄：合成王\n結算：逃離", "/flee");
  app.observe(statusText(), "/status");
  const lines = inventoryText().split("\n");
  app.observe(
    [
      lines[0],
      lines[2].replace("2.", "1."),
      lines[1].replace("1.", "2."),
      ...lines.slice(3),
    ].join("\n"),
    "/inventory all",
  );
  const same = await app.call("bears_combat_snapshot", {
    mode: "boss",
    includeHistory: true,
  });
  expect(same.data.history).toMatchObject({
    samples: [
      {
        lastObservedConditionComparison: {
          equipment: { added: [], removed: [], changed: [] },
        },
      },
    ],
  });
  app.observe(
    inventoryText().replace("ATK +5", "ATK +5、未知授技：護盾"),
    "/inventory all",
  );
  const changed = await app.call("bears_combat_snapshot", {
    mode: "boss",
    includeHistory: true,
  });
  expect(changed.data.history).toMatchObject({
    samples: [
      {
        lastObservedConditionComparison: {
          equipment: {
            changed: [
              {
                name: "🟠⚔️傳世鋼鐵巨劍",
                after: { description: expect.stringContaining("未知授技") },
              },
            ],
          },
          conditionsComplete: false,
        },
      },
    ],
  });
  expect(app.sent).toEqual([]);
});

test("同名分組不按名稱挑一組比較，技能差異有界且明列省略數", async () => {
  const app = workflowHarness();
  app.seed();
  const duplicate = inventoryText().replace("傳世青銅巨劍", "傳世鋼鐵巨劍");
  app.observe(duplicate, "/inventory all");
  const skills =
    "技能列表\n" +
    Array.from(
      { length: 25 },
      (_, i) => `合成招${i}（12MP）期望傷害：200；無其他成本`,
    ).join("\n");
  app.observe(skills, "/skills");
  app.observe("戰鬥紀錄：合成王\n結算：逃離", "/flee");
  app.observe(statusText(), "/status");
  app.observe(duplicate.replace("ATK +5", "ATK +6"), "/inventory all");
  app.observe(skills.replaceAll("12MP", "14MP"), "/skills");
  const result = await app.call("bears_combat_snapshot", {
    mode: "boss",
    includeHistory: true,
  });
  expect(result.data.history).toMatchObject({
    samples: [
      {
        lastObservedConditionComparison: {
          equipment: { changed: [], ambiguousNames: ["🟠⚔️傳世鋼鐵巨劍"] },
          skills: { changed: expect.any(Array), omitted: { changed: 5 } },
          conditionsComplete: false,
        },
      },
    ],
  });
  const history = result.data.history as {
    samples: {
      lastObservedConditionComparison: { skills: { changed: unknown[] } };
    }[];
  };
  expect(
    history.samples[0].lastObservedConditionComparison.skills.changed,
  ).toHaveLength(20);
  expect(app.sent).toEqual([]);
});

test("戰後才觀測的舊訊息修訂不能回填為戰前配裝", async () => {
  const app = workflowHarness();
  app.seed();
  const original = app.store
    .all()
    .find((record) => record.message.text.startsWith("🎒 背包"));
  if (!original) {
    throw new Error("測試缺少背包");
  }
  app.observe("戰鬥紀錄：合成王\n結算：逃離", "/flee");
  vi.mocked(Date.now).mockReturnValue(NOW + 1000);
  app.store.observe(
    [
      {
        ...original.message,
        revision: "post_battle_revision",
        text: inventoryText(2),
      },
    ],
    "/inventory all",
  );
  app.observe(statusText(), "/status");
  app.observe(inventoryText(2), "/inventory all");
  const result = await app.call("bears_combat_snapshot", {
    mode: "boss",
    includeHistory: true,
  });
  expect(result.data.history).toMatchObject({
    samples: [
      {
        lastObservedEquipment: null,
        lastObservedConditionComparison: {
          equipment: null,
          missingBlocks: expect.arrayContaining(["equipment"]),
        },
      },
    ],
  });
  expect(app.sent).toEqual([]);
});

test("敵血零未結算不算勝、修訂替換而非新增，未知原生不產生資格", async () => {
  const app = workflowHarness();
  app.seed();
  const receipt = app.observe(
    "戰鬥紀錄：合成王\n對敵傷害：100；敵HP：100→0/100\n結算：勝利\n獲得金幣：10G",
    "/skill 合成招",
  );
  app.store.observe(
    [
      {
        ...receipt,
        revision: "revised",
        text: "戰鬥紀錄：合成王\n對敵傷害：100；敵HP：100→0/100\n狀態：戰鬥中",
      },
    ],
    "/skill 合成招",
  );
  app.observe("未知原生掛機新勝回報");
  const result = await app.call("bears_combat_snapshot", {
    mode: "boss",
    includeHistory: true,
  });
  expect(result.data.history).toMatchObject({
    samples: [],
    incompleteSources: [{ messageId: receipt.id, revision: "revised" }],
    personalCooldown: { eligible: null },
  });
  app.store.reset();
  const reset = await app.call("bears_combat_snapshot", {
    mode: "boss",
    includeHistory: true,
  });
  expect(reset.data.history).toMatchObject({
    samples: [],
    incompleteSources: [],
  });
  expect(app.sent).toEqual([]);
});
