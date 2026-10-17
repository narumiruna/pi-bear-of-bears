import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { Room } from "../src/world.js";
import {
  homeText,
  inventoryText,
  message,
  NOW,
  roomText,
  statusText,
  towerText,
  workflowHarness,
} from "./fixtures/workflow.js";

beforeEach(() => vi.spyOn(Date, "now").mockReturnValue(NOW));
afterEach(() => vi.restoreAllMocks());
function deferred() {
  let resolve: (value: string) => void = () => {};
  const promise = new Promise<string>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

test("兩個流程並行不交錯；流程與既有單指令共享鎖", async () => {
  const app = workflowHarness();
  const point = app.seed();
  const gate = deferred(),
    started = deferred();
  app.overrides.set("/status", () => {
    started.resolve("started");
    return gate.promise;
  });
  const one = app.call("bears_tower_recover", { scope: app.scope(point.id) });
  await started.promise;
  const two = await app.call("bears_move_to", {
    scope: app.scope(point.id),
    destination: 2,
  });
  expect(two.state).toBe("stopped");
  expect(two.blockers.join(" ")).toContain("already running");
  // 真正單指令 Game 排他另由 game-operation.test.ts 驗證。
  gate.resolve(statusText());
  await one;
  expect(app.sent.filter((command) => command.startsWith("/go"))).toEqual([]);
});

test("session／tree 重設取消流程，舊 generation 不回填，也不恢復待送操作", async () => {
  const app = workflowHarness();
  const point = app.seed();
  const gate = deferred(),
    started = deferred();
  app.overrides.set("/status", () => {
    started.resolve("started");
    return gate.promise;
  });
  const work = app.call("bears_tower_recover", { scope: app.scope(point.id) });
  await started.promise;
  const generation = app.store.generation;
  app.store.reset();
  gate.resolve(statusText());
  const result = await work;
  expect(result.state).toBe("stopped");
  expect(app.sent).toEqual(["/status"]);
  app.store.observe([message(999, statusText())], "/status", 0, generation);
  expect(app.store.status()?.source.messageId).not.toBe(999);
  expect(() => app.store.get(point.id)).toThrow();
});

test("取消在已送出休息之後：結果不明，不再查詢、不補救或重送", async () => {
  const app = workflowHarness();
  const point = app.seed();
  const controller = new AbortController();
  app.overrides.set("/rest", () => {
    controller.abort();
    return "免費休息，HP／MP 已恢復。";
  });
  const result = await app.call(
    "bears_tower_recover",
    { scope: app.scope(point.id) },
    controller.signal,
  );
  expect(result.state).toBe("outcome_unknown");
  expect(app.sent.at(-1)).toBe("/rest");
  expect(app.sent.filter((command) => command === "/rest")).toHaveLength(1);
});

test("明確拒絕不是成功，也不因補讀而重送", async () => {
  const app = workflowHarness();
  const point = app.seed();
  let histories = 0;
  app.overrides.set("/rest", () => "無法休息，條件不足。");
  app.onHistory(() => {
    if (app.sent.includes("/rest")) {
      histories++;
    }
  });
  const result = await app.call("bears_tower_recover", {
    scope: app.scope(point.id),
  });
  expect(result.state).toBe("stopped");
  expect(result.steps.at(-1)).toMatchObject({
    tool: "bears_rest",
    state: "rejected",
  });
  expect(histories).toBe(0);
  expect(app.sent.filter((command) => command === "/rest")).toHaveLength(1);
});

test("跨層或同內容新 message ID 不能沿用舊 snapshotId，即使 revision 相同", async () => {
  const app = workflowHarness();
  app.seed();
  const snapshot = await app.call("bears_combat_snapshot", { mode: "tower" });
  const point = app.store.get(snapshot.data.snapshotId as string);
  const tower = app.raw.find((record) => record.text.includes("無盡星塔"));
  if (!tower) {
    throw new Error("缺少塔訊息");
  }
  const newer = { ...tower, id: 100, text: towerText(31) };
  app.raw.push(newer);
  app.store.observe([newer], "/tower");
  expect(() => app.store.assertCurrent(point.id, "測試熊")).toThrow("更新");
  const same = workflowHarness();
  const old = same.seed();
  const source = same.raw[0];
  same.raw.push({ ...source, id: 200 });
  same.store.observe([{ ...source, id: 200 }], "/status");
  expect(() => same.store.assertCurrent(old.id, "測試熊")).toThrow();
});

test("觀測 runtime 護盾與易傷但不轉成安全保證；新行動使舊效果失效", () => {
  const app = workflowHarness();
  app.seed();
  app.store.invalidate();
  app.observe("接下來3次受擊減傷18%\n易傷25%\nDOT：100", "/skill 合成護盾");
  app.observe(statusText(), "/status");
  app.observe(towerText(), "/tower");
  app.observe("技能列表\n合成招（12MP）期望傷害：200；無其他成本", "/skills");
  expect(
    app.store.runtimeEffects()?.effects.map((effect) => effect.kind),
  ).toEqual(["damage_reduction", "vulnerability", "dot"]);
  app.store.invalidate();
  app.observe(statusText(), "/status");
  expect(app.store.runtimeEffects()).toBeNull();
});

test("部分導航成功後下一步被拒，保留實走及最後位置，不回滾或重跑", async () => {
  const app = workflowHarness();
  const point = app.seed();
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
        description: "",
        exits: { 下: 3 },
      },
      {
        id: 3,
        name: "終點",
        safe: true,
        boss: false,
        description: "",
        exits: {},
      },
    ],
  );
  app.overrides.set("/look", () => roomText(app.state.location, "下"));
  let moves = 0;
  app.overrides.set("/go 下", () => {
    moves++;
    if (moves === 1) {
      app.state.location = "安全站";
      return `你往下走去\n${roomText("安全站", "下")}`;
    }
    return "無法通行。";
  });
  const result = await app.call("bears_move_to", {
    scope: app.scope(point.id),
    destination: "終點",
  });
  expect(result.state).toBe("stopped");
  expect(result.data.lastLocation).toBe("安全站");
  expect(result.data.walked).toEqual([{ direction: "下", room: "安全站" }]);
  expect(app.sent.filter((command) => command === "/go 下")).toHaveLength(2);
  expect(app.sent).not.toContain("/go 上");
});

test.each([NaN, Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
  "schema 拒絕非法範圍 %s，不送出指令",
  async (value) => {
    const app = workflowHarness();
    const point = app.seed();
    await expect(
      app.call("bears_move_to", {
        scope: { ...app.scope(point.id), maxChanges: value },
        destination: 2,
      }),
    ).rejects.toThrow("schema");
    expect(app.sent).toEqual([]);
  },
);

test.each(["/attack", "星塔\n/attack", "地點\u0000", " 地點", "地點 "])(
  "拒絕名稱注入與頭尾空白 %s",
  async (destination) => {
    const app = workflowHarness();
    const point = app.seed();
    await expect(
      app.call("bears_move_to", { scope: app.scope(point.id), destination }),
    ).rejects.toThrow();
    expect(app.sent).toEqual([]);
  },
);

test("當次已確認樓層改為未知、自動扣款資源不足，只回報查證結果", async () => {
  const app = workflowHarness();
  app.seed();
  app.overrides.set("/tower", () =>
    towerText(30, 900, "合成星主", "碎晶×2 或 300,000G（自動擇一）"),
  );
  const result = await app.call("bears_tower_entry_check", {
    character: "測試熊",
    freeOnly: false,
  });
  expect(result.state).toBe("needs_observation");
  expect(result.data.heldCrystals).toBe(0);
  expect(result.blockers.join(" ")).toContain("不足");
  expect(app.sent.some((command) => command.startsWith("/tower go"))).toBe(
    false,
  );
});

test("準備後跨層、野外戰鬥或步行起點改變，不自動套用新遭遇或新路線", async () => {
  const changed = workflowHarness();
  const old = changed.seed();
  changed.overrides.set("/tower", () => towerText(31));
  const recovery = await changed.call("bears_tower_recover", {
    scope: changed.scope(old.id),
  });
  expect(recovery.state).toBe("stopped");
  expect(changed.sent.filter((command) => /flee|rest/u.test(command))).toEqual(
    [],
  );
  const wild = workflowHarness();
  wild.state.location = "水晶洞窟";
  wild.state.inCombat = true;
  const target = wild.seed();
  const refusal = await wild.call("bears_tower_recover", {
    scope: wild.scope(target.id),
  });
  expect(refusal.state).toBe("stopped");
  expect(wild.sent.filter((command) => /flee|rest/u.test(command))).toEqual([]);
  const moved = workflowHarness();
  const start = moved.seed();
  moved.state.location = "安全站";
  const route = await moved.call("bears_move_to", {
    scope: moved.scope(start.id),
    destination: 2,
  });
  expect(route.state).toBe("stopped");
  expect(moved.sent.filter((command) => command.startsWith("/go"))).toEqual([]);
});

test("前置 scope 角色不符時，回報真實最後觀測身分而非輸入的角色", async () => {
  const app = workflowHarness();
  const point = app.seed();
  const result = await app.call("bears_tower_recover", {
    scope: { ...app.scope(point.id), character: "另一熊" },
  });
  expect(result.state).toBe("stopped");
  expect(result.actor).toBe("測試熊");
  expect(result.data.requestedCharacter).toBe("另一熊");
  expect(result.data.lastStatus).toMatchObject({ name: "測試熊" });
  expect(app.sent).toEqual([]);
});

test("當次明列自動擇一條件，依本人資源選擇分支但不入塔", async () => {
  const app = workflowHarness();
  app.seed();
  app.state.gold = 400000;
  const quote = `${towerText(30, 900, "合成星主", "碎晶×2 或 300,000G（自動擇一）")}\n自動擇一規則：碎晶足夠時優先使用碎晶，不足時改扣金幣`;
  app.overrides.set("/tower", () => quote);
  const fallback = await app.call("bears_tower_entry_check", {
    character: "測試熊",
    floor: 30,
    freeOnly: false,
  });
  expect(fallback.state).toBe("ready");
  expect(fallback.data.selectedPayment).toEqual({
    currency: "gold",
    amount: 300000,
  });
  const withCrystals = inventoryText()
    .replace("背包（3 種", "背包（4 種")
    .replace(
      "🔢 用編號最方便：",
      "4. 星核碎晶 x2 — 合成測試材料。\n🔢 用編號最方便：",
    );
  app.observe(withCrystals, "/inventory all");
  app.state.gold = 1000;
  const material = await app.call("bears_tower_entry_check", {
    character: "測試熊",
    floor: 30,
    freeOnly: false,
  });
  expect(material.state).toBe("ready");
  expect(material.data.selectedPayment).toEqual({
    currency: "crystals",
    amount: 2,
  });
  expect(app.sent.some((command) => /tower go|tower quit/u.test(command))).toBe(
    false,
  );
});

test("對帳存款真正手續費、未知活動與物品有效屬性變更不掩蓋缺口", async () => {
  const app = workflowHarness();
  const before = app.seed();
  app.observe("存款成功：900G\n手續費：3G", "/deposit 900");
  vi.spyOn(Date, "now").mockReturnValue(NOW + 60000);
  app.observe(statusText("測試熊", 900, 60, 97), "/status");
  app.observe(homeText(97, 900), "/home");
  app.observe(inventoryText(), "/inventory all");
  const after = app.store.capture();
  const result = await app.call("bears_reconcile_rewards", {
    before: before.id,
    after: after.id,
  });
  expect(result.state).toBe("confirmed");
  expect(result.data.actualDelta).toBe(-3);
  expect(result.data.debits).toBe(3);
  app.observe("無法歸因的外部動作");
  app.observe(statusText("測試熊", 900, 60, 97), "/status");
  app.observe(inventoryText().replace("ATK +5", "ATK +6"), "/inventory all");
  const end = app.store.capture();
  const partial = await app.call("bears_reconcile_rewards", {
    before: after.id,
    after: end.id,
  });
  expect(partial.state).toBe("needs_observation");
  expect(partial.blockers.join(" ")).toContain("屬性已改變");
});
