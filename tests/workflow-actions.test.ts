import { Check } from "typebox/value";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { beginAutoIdle } from "../src/auto-idle-state.js";
import { WORKFLOW_RESULT_SCHEMA } from "../src/workflow-result.js";
import type { Room } from "../src/world.js";
import {
  inventoryText,
  NOW,
  roomText,
  statusText,
  towerText,
  workflowHarness,
} from "./fixtures/workflow.js";

beforeEach(() => vi.spyOn(Date, "now").mockReturnValue(NOW));
afterEach(() => vi.restoreAllMocks());
const weights = { attack: 1, defense: 1, intelligence: 1, agility: 1 };

test("十個 tools 都是 codemode、structured output，沒有接受任意 script 或狀態 JSON", async () => {
  const app = workflowHarness();
  app.seed();
  for (const name of [
    "bears_combat_snapshot",
    "bears_inventory_snapshot",
    "bears_reconcile_rewards",
    "bears_plan_tower_step",
    "bears_tower_recover",
    "bears_move_to",
    "bears_equip_upgrade",
    "bears_tower_entry_check",
    "bears_plan_upgrade",
    "bears_balance_wallet",
  ]) {
    const tool = app.tools.get(name);
    expect(tool?.exposure).toBe("codemode");
    expect(tool?.outputSchema).toBe(WORKFLOW_RESULT_SCHEMA);
    await expect(
      app.call(name, { script: "/attack", hp: 999, authorized: true }),
    ).rejects.toThrow("schema");
  }
  const snapshot = await app.call("bears_combat_snapshot", { mode: "tower" });
  expect(Check(WORKFLOW_RESULT_SCHEMA, snapshot)).toBe(true);
  expect(snapshot.data.snapshotId).toBeTypeOf("string");
  expect(app.sent).toEqual([]);
});

test("星塔恢復正常流程：一次收刀、一次免費休息，不退出或重新入塔", async () => {
  const app = workflowHarness();
  app.state.inCombat = true;
  const point = app.seed();
  const result = await app.call("bears_tower_recover", {
    scope: app.scope(point.id),
  });
  expect(result.blockers).toEqual([]);
  expect(result.state).toBe("confirmed");
  expect(result.data.recovered).toEqual({ hp: 100, mp: 40, gold: 0 });
  expect(app.sent.filter((command) => command === "/flee")).toHaveLength(1);
  expect(app.sent.filter((command) => command === "/rest")).toHaveLength(1);
  expect(
    app.sent.some((command) =>
      /tower (?:go|quit)|\/skill|\/use/u.test(command),
    ),
  ).toBe(false);
});

test("已滿資源不收刀或休息；非免費恢復不測價", async () => {
  const app = workflowHarness();
  app.state.hp = 1000;
  app.state.mp = 100;
  const point = app.seed();
  expect(
    (await app.call("bears_tower_recover", { scope: app.scope(point.id) }))
      .state,
  ).toBe("confirmed");
  expect(app.sent).not.toContain("/rest");
  app.state.hp = 900;
  app.state.mp = 60;
  app.observe(statusText(), "/status");
  const next = app.store.capture();
  app.overrides.set("/look", () =>
    roomText("星塔前庭", "下", "安全區域；可休息"),
  );
  const result = await app.call("bears_tower_recover", {
    scope: app.scope(next.id),
  });
  expect(result.state).toBe("stopped");
  expect(app.sent).not.toContain("/rest");
});

test.each(["fee", "challenge", "hp", "role"])(
  "恢復驗收拒絕 %s 改變，不補救或重入",
  async (kind) => {
    const app = workflowHarness();
    const point = app.seed();
    app.overrides.set("/rest", () => {
      app.state.hp = 1000;
      app.state.mp = 100;
      if (kind === "fee") {
        app.state.gold--;
      }
      if (kind === "challenge") {
        app.state.floor++;
      }
      if (kind === "hp") {
        app.state.enemyHp--;
      }
      if (kind === "role") {
        app.state.name = "乙熊";
      }
      return "免費休息，HP／MP 已恢復。";
    });
    const result = await app.call("bears_tower_recover", {
      scope: app.scope(point.id),
    });
    expect(result.state).not.toBe("confirmed");
    expect(app.sent.filter((command) => command === "/rest")).toHaveLength(1);
    expect(app.sent).not.toContain("/tower quit");
  },
);

test("星塔查詢回報免費／付費、樓層與未知自動扣款，不入塔", async () => {
  const app = workflowHarness();
  app.seed();
  const free = await app.call("bears_tower_entry_check", {
    character: "測試熊",
    floor: 30,
    freeOnly: true,
  });
  expect(free.state).toBe("ready");
  expect(free.data.eligible).toBe(true);
  app.overrides.set("/tower", () =>
    towerText(30, 900, "王", "碎晶×2 或 300,000G（自動擇一）"),
  );
  const paid = await app.call("bears_tower_entry_check", {
    character: "測試熊",
    floor: 31,
    freeOnly: true,
  });
  expect(paid.state).toBe("needs_observation");
  expect(paid.blockers.join(" ")).toContain("自動擇一");
  expect(
    app.sent.every((command) => command === "/status" || command === "/tower"),
  ).toBe(true);
});

test("查詢不切角；掛機中的角色不發可能中斷的 tower 查詢", async () => {
  const app = workflowHarness();
  app.state.idle = true;
  app.seed();
  expect(
    (
      await app.call("bears_tower_entry_check", {
        character: "測試熊",
        freeOnly: true,
      })
    ).state,
  ).toBe("stopped");
  expect(app.sent).toEqual(["/status"]);
});

test("六方向導航：逐步核對實際出口、狀態及目的地", async () => {
  const app = workflowHarness();
  const point = app.seed();
  const result = await app.call("bears_move_to", {
    scope: app.scope(point.id),
    destination: "安全站",
  });
  expect(result.blockers).toEqual([]);
  expect(result.state).toBe("confirmed");
  expect(result.data.lastLocation).toBe("安全站");
  expect(app.sent.filter((command) => command.startsWith("/go "))).toEqual([
    "/go 下",
  ]);
  expect(
    app.sent.some((command) => /goto|recall|bebe|attack|skill/u.test(command)),
  ).toBe(false);
});

test("導航支援原生箭頭出口，仍逐步核對目的地與金幣", async () => {
  const app = workflowHarness();
  const point = app.seed();
  app.overrides.set("/look", () =>
    roomText(
      app.state.location,
      app.state.location === "星塔前庭" ? "下→安全站" : "上→星塔前庭",
    ),
  );
  const result = await app.call("bears_move_to", {
    scope: app.scope(point.id),
    destination: "安全站",
  });
  expect(result.state).toBe("confirmed");
  expect(result.data.walked).toEqual([{ direction: "下", room: "安全站" }]);
  expect(result.data.observedGoldSpend).toBe(0);
  expect(app.sent.filter((command) => command.startsWith("/go "))).toEqual([
    "/go 下",
  ]);
});

test("導航不使用缺少目的地的箭頭出口", async () => {
  const app = workflowHarness();
  const point = app.seed();
  app.overrides.set("/look", () => roomText("星塔前庭", "下→"));
  const result = await app.call("bears_move_to", {
    scope: app.scope(point.id),
    destination: "安全站",
  });
  expect(result.state).toBe("stopped");
  expect(app.sent.some((command) => command.startsWith("/go "))).toBe(false);
});

test.each(["exit", "boss", "ambiguous", "fee", "destination"])(
  "導航停止 %s 缺口，不猜替代動作",
  async (kind) => {
    const app = workflowHarness();
    const point = app.seed();
    if (kind === "exit") {
      app.overrides.set("/look", () => roomText("星塔前庭", "北"));
    }
    if (kind === "boss") {
      app.world.allRooms = vi.fn(
        async (): Promise<Room[]> => [
          {
            id: 1,
            name: "星塔前庭",
            safe: true,
            boss: false,
            description: "",
            exits: { 下: 2 },
          },
          {
            id: 2,
            name: "安全站",
            safe: false,
            boss: true,
            description: "",
            exits: {},
          },
        ],
      );
    }
    if (kind === "ambiguous") {
      app.world.allRooms = vi.fn(async () => [
        {
          id: 1,
          name: "星塔前庭",
          safe: true,
          boss: false,
          description: "",
          exits: {},
        },
        {
          id: 2,
          name: "安全站",
          safe: true,
          boss: false,
          description: "",
          exits: {},
        },
        {
          id: 3,
          name: "安全站",
          safe: true,
          boss: false,
          description: "",
          exits: {},
        },
      ]);
    }
    if (kind === "fee") {
      app.world.allRooms = vi.fn(
        async (): Promise<Room[]> => [
          {
            id: 1,
            name: "星塔前庭",
            safe: true,
            boss: false,
            description: "",
            exits: { 下: 2 },
          },
          {
            id: 2,
            name: "安全站",
            safe: true,
            boss: false,
            description: "需要門票",
            exits: {},
          },
        ],
      );
    }
    if (kind === "destination") {
      app.overrides.set(
        "/go 下",
        () => `你往下走去\n${roomText("其他地點", "上")}`,
      );
    }
    const result = await app.call("bears_move_to", {
      scope: app.scope(point.id),
      destination: "安全站",
    });
    expect(result.state).not.toBe("confirmed");
    expect(app.sent.filter((command) => command === "/go 下")).toHaveLength(
      kind === "destination" ? 1 : 0,
    );
  },
);

test("單件嚴格提升換裝：刷新、重算、一次 equip、新背包驗收", async () => {
  const app = workflowHarness();
  const point = app.seed();
  const result = await app.call("bears_equip_upgrade", {
    scope: app.scope(point.id),
    weights,
  });
  expect(result.blockers).toEqual([]);
  expect(result.state).toBe("confirmed");
  expect(result.data.changed).toBe(true);
  expect(app.sent.filter((command) => command.startsWith("/equip"))).toEqual([
    "/equip 2",
  ]);
  expect(app.sent).not.toContain("/autoequip");
  expect(app.sent).not.toContain("/stopidle");
  const lastInventory = app.sent.lastIndexOf("/inventory all");
  expect(lastInventory).toBeGreaterThan(app.sent.indexOf("/equip 2"));
});

test("換裝已知非零完整費用須在 scope 內且與實支吻合", async () => {
  const app = workflowHarness();
  const point = app.seed();
  app.overrides.set("/look", () =>
    roomText("星塔前庭", "下", "安全區域\n裝備費用：5G"),
  );
  app.overrides.set("/equip 2", () => {
    app.state.worn = 2;
    app.state.gold -= 5;
    return "已裝備 🟠⚔️傳世青銅巨劍";
  });
  const result = await app.call("bears_equip_upgrade", {
    scope: { ...app.scope(point.id), maxGold: 5 },
    weights,
  });
  expect(result.state).toBe("confirmed");
  expect(result.data.actualGold).toBe(5);
  expect(app.sent.filter((command) => command.startsWith("/equip"))).toEqual([
    "/equip 2",
  ]);
});

test.each(["tie", "effects", "renumber", "fee", "notworn"])(
  "換裝 %s 不誤報成功或回滾",
  async (kind) => {
    const app = workflowHarness();
    const point = app.seed();
    let inventories = 0;
    app.overrides.set("/inventory all", () => {
      inventories++;
      if (kind === "tie") {
        return inventoryText().replace("ATK +10", "ATK +5");
      }
      if (kind === "effects") {
        return inventoryText().replace(
          "ATK +10（Lv1 可裝備）",
          "ATK +10；被動吸血（Lv1 可裝備）",
        );
      }
      if (kind === "renumber" && inventories >= 2) {
        return inventoryText().replaceAll("傳世青銅巨劍", "傳世黃金巨劍");
      }
      if (kind === "notworn") {
        return inventoryText(1);
      }
      return inventoryText();
    });
    if (kind === "fee") {
      app.overrides.set("/look", () => roomText("星塔前庭", "下", "安全區域"));
    }
    const result = await app.call("bears_equip_upgrade", {
      scope: app.scope(point.id),
      weights,
    });
    if (kind === "tie") {
      expect(result.state).toBe("confirmed");
      expect(result.data.changed).toBe(false);
    } else {
      expect(result.state).not.toBe("confirmed");
    }
    expect(
      app.sent.filter((command) => command.startsWith("/equip")),
    ).toHaveLength(kind === "notworn" ? 1 : 0);
  },
);

test("結果不明最多補讀兩次：不重送休息、late reply 可確認", async () => {
  const app = workflowHarness();
  const point = app.seed();
  let histories = 0;
  app.overrides.set("/rest", () => "");
  app.onHistory(() => {
    if (app.sent.includes("/rest")) {
      histories++;
    }
  });
  const unknown = await app.call("bears_tower_recover", {
    scope: app.scope(point.id),
  });
  expect(unknown.state).toBe("outcome_unknown");
  expect(histories).toBe(2);
  expect(app.sent.filter((command) => command === "/rest")).toHaveLength(1);
  const late = workflowHarness();
  const next = late.seed();
  late.overrides.set("/rest", () => "");
  let delivered = false;
  late.onHistory(() => {
    if (late.sent.includes("/rest") && !delivered) {
      delivered = true;
      late.state.hp = 1000;
      late.state.mp = 100;
      late.observe("免費休息，HP／MP 已恢復。", "/rest");
    }
  });
  expect(
    (await late.call("bears_tower_recover", { scope: late.scope(next.id) }))
      .state,
  ).toBe("confirmed");
  expect(late.sent.filter((command) => command === "/rest")).toHaveLength(1);
});

test("取消、rate limit、範圍不足與角色變更不再送出下一筆", async () => {
  const app = workflowHarness();
  const point = app.seed();
  await expect(
    app.call(
      "bears_tower_recover",
      { scope: app.scope(point.id) },
      AbortSignal.abort(),
    ),
  ).rejects.toThrow();
  expect(app.sent).toEqual([]);
  app.overrides.set("/status", () => {
    throw new Error("Telegram rate limit: wait 10 seconds");
  });
  const limited = await app.call("bears_tower_recover", {
    scope: app.scope(point.id),
  });
  expect(limited.state).toBe("stopped");
  expect(app.sent).toEqual(["/status"]);
  const bounded = workflowHarness();
  const p = bounded.seed();
  expect(
    (
      await bounded.call("bears_move_to", {
        scope: { ...bounded.scope(p.id), maxCommands: 1 },
        destination: 2,
      })
    ).state,
  ).toBe("stopped");
  expect(bounded.sent).toEqual([]);
  const changed = workflowHarness();
  const c = changed.seed();
  changed.overrides.set("/status", () => statusText("乙熊"));
  expect(
    (await changed.call("bears_tower_recover", { scope: changed.scope(c.id) }))
      .state,
  ).toBe("stopped");
  expect(changed.sent).toEqual(["/status"]);
});

test("Auto Idle 排他與來源修訂 gate：任何狀態變更前停止", async () => {
  const app = workflowHarness();
  const point = app.seed();
  const release = beginAutoIdle();
  try {
    expect(
      (await app.call("bears_tower_recover", { scope: app.scope(point.id) }))
        .state,
    ).toBe("stopped");
    expect(app.sent).toEqual([]);
  } finally {
    release();
  }
  app.onHistory(() => {
    const source = app.raw.find(
      (record) => record.id === point.sources[0].messageId,
    );
    if (source) {
      source.revision = "b".repeat(64);
    }
  });
  const stale = await app.call("bears_tower_recover", {
    scope: app.scope(point.id),
  });
  expect(stale.state).toBe("stopped");
  expect(app.sent).toEqual([]);
});
