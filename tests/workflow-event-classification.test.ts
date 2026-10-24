import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { idleReportCharacter } from "../src/workflow-events.js";
import { reconcileRewards } from "../src/workflow-rewards.js";
import {
  inventoryText,
  NOW,
  statusText,
  workflowHarness,
} from "./fixtures/workflow.js";

beforeEach(() => vi.spyOn(Date, "now").mockReturnValue(NOW));
afterEach(() => vi.restoreAllMocks());

test.each([undefined, "/look", "/skill 合成護盾"])(
  "未知訊息不能靠局部效果文字略過 barrier：%s",
  (request) => {
    const app = workflowHarness();
    const point = app.seed();
    const event = app.observe(
      "未知世界獎勵\n接下來3次受擊減傷18%\n金幣 +100G",
      request,
    );
    expect(app.store.status()).toBeUndefined();
    expect(app.store.runtimeEffects()).toBeNull();
    expect(app.store.invalidationEvent()).toMatchObject({
      kind: "unknown_bot_reply",
      messageId: event.id,
    });
    expect(() => app.store.assertCurrent(point.id, "測試熊")).toThrow();
    expect(app.sent).toEqual([]);
  },
);

test("未綁定 skill 回覆的孤立效果行仍是未知活動", () => {
  const app = workflowHarness();
  app.seed();
  app.observe("接下來3次受擊減傷18%");
  expect(app.store.status()).toBeUndefined();
  expect(app.store.runtimeEffects()).toBeNull();
});

test("完整他角標籤式回報可辨識；混合本人獎勵、未知尾行或前綴相似不略過", () => {
  const own = "【測試熊】\n🐾 掛機 1 小時，金幣 +100G";
  const other = own.replace("測試熊", "乙熊");
  expect(idleReportCharacter(other)).toBe("乙熊");
  for (const unknown of [
    `${other}\n本人獲得金幣：100G`,
    `${other}\n未知格式`,
    `前綴\n${other}`,
  ]) {
    expect(idleReportCharacter(unknown)).toBeNull();
    const app = workflowHarness();
    app.seed();
    app.observe(unknown);
    expect(app.store.status()).toBeUndefined();
    expect(app.equipment.evaluate()).toMatchObject({ applicable: false });
    expect(app.store.statusInvalidation()).toMatchObject({
      kind: "unknown_bot_reply",
      affectedBlocks: [
        "status",
        "tower",
        "room",
        "home",
        "skills",
        "inventory",
      ],
    });
  }
});

test("本人資源回報使來源失效，保留訊息 ID／revision 與原因；他角整份回報不失效", () => {
  const app = workflowHarness();
  const point = app.seed();
  app.observe("【乙熊】\n🐾 掛機 1 小時，金幣 +100G");
  expect(app.store.status()?.value.name).toBe("測試熊");
  app.store.assertCurrent(point.id, "測試熊");
  const own = app.observe("【測試熊】\n🐾 掛機 1 小時，金幣 +100G");
  expect(app.store.status()).toBeUndefined();
  expect(app.store.statusInvalidation()).toMatchObject({
    kind: "own_resource_report",
    messageId: own.id,
    revision: own.revision,
  });
  expect(() => app.store.assertCurrent(point.id, "測試熊")).toThrow();
});

test("已綁定來源改寫成他角回報仍須失效，不以公告分類吞掉 revision", () => {
  const app = workflowHarness();
  const point = app.seed();
  const previous = app.raw.find((message) => message.id === 2);
  if (!previous) {
    throw new Error("fixture 缺頁");
  }
  const revision = {
    ...previous,
    text: "【乙熊】\n🐾 掛機 1 小時，金幣 +100G",
    revision: "changed",
  };
  app.store.observe([revision]);
  app.equipment.observeLive([revision]);
  expect(() => app.store.get(point.id)).toThrow("修訂");
  expect(app.equipment.evaluate().applicable).toBe(false);
});

test("本人回執改署他角時替換原事件，不保留舊金幣入帳", () => {
  const app = workflowHarness();
  const before = app.seed();
  const receipt = app.observe(
    "【測試熊】\n🐾 掛機 1 小時，金幣 +100G",
    "/stopidle",
  );
  vi.mocked(Date.now).mockReturnValue(NOW + 60000);
  app.observe(statusText("測試熊", 900, 60, 1100), "/status");
  app.observe(inventoryText(), "/inventory all");
  const after = app.store.capture();
  app.store.observe([
    {
      ...receipt,
      text: receipt.text.replace("測試熊", "乙熊"),
      revision: "changed",
    },
  ]);
  const result = reconcileRewards(app.store, before.id, after.id);
  expect(result.data.credits).toBe(0);
  expect(result.data.unexplained).toBe(100);
});

test("沒有 status 的未知事件不冒稱本人結算，來源淘汰後仍列出原因與缺證", () => {
  const app = workflowHarness();
  const event = app.observe("未知訊息，沒有角色證據");
  expect(app.store.invalidationEvent()).toMatchObject({
    kind: "unknown_bot_reply",
    messageId: event.id,
    revision: event.revision,
    sourceMissing: false,
    scope: "historical_barrier_event",
  });
  for (let index = 0; index < 600; index++) {
    app.observe(statusText(), "/status");
  }
  expect(app.store.invalidationEvent()).toMatchObject({
    kind: "unknown_bot_reply",
    messageId: event.id,
    sourceMissing: true,
    source: null,
  });
  expect(app.sent).toEqual([]);
});

test("背包缺證及流程停止都輸出失效區塊；後續新觀測不被歷史事件冒稱失效", async () => {
  const app = workflowHarness();
  const point = app.seed();
  const event = app.observe("未知資源變動");
  app.observe(statusText(), "/status");
  const inventory = await app.call("bears_inventory_snapshot", {});
  expect(inventory.data.invalidationEvent).toMatchObject({
    kind: "unknown_bot_reply",
    messageId: event.id,
    affectedBlocks: ["status", "tower", "room", "home", "skills", "inventory"],
    scope: "historical_barrier_event",
  });
  expect(app.store.continuation()).toMatchObject({
    statusFresh: true,
    statusInvalidation: null,
    invalidationEvent: { messageId: event.id },
  });
  const stopped = await app.call("bears_move_to", {
    scope: app.scope(point.id),
    destination: 2,
  });
  expect(stopped.state).toBe("stopped");
  expect(stopped.data.invalidationEvent).toMatchObject({
    messageId: event.id,
    revision: event.revision,
  });
  expect(stopped.data.invalidationEvent).not.toHaveProperty("request");
  app.observe(inventoryText(), "/inventory all");
  const fresh = await app.call("bears_inventory_snapshot", {});
  expect(fresh.state).toBe("ready");
  expect(fresh.data).not.toHaveProperty("invalidationEvent");
  expect(app.sent).toEqual([]);
});

test("未保存真實世界血線格式前，包含世界王文字仍不能全域略過 barrier", () => {
  const app = workflowHarness();
  app.seed();
  app.observe("世界王血線未知格式；本人獎勵尚未核對");
  expect(app.store.status()).toBeUndefined();
  expect(app.store.statusInvalidation()?.kind).toBe("unknown_bot_reply");
});
