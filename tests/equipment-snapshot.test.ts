import { expect, test } from "vitest";
import { EquipmentSnapshot } from "../src/equipment-snapshot.js";
import type { GameMessage } from "../src/game.js";

const message: GameMessage = {
  id: 1,
  date: 100,
  revision: "a".repeat(64),
  outgoing: false,
  buttons: [],
  hasMedia: false,
  text: "🎒 背包（2 種）：\n  1. 護甲 【裝備中】— 防禦 +6\n…另有 1 種未列出\n🔢 用編號最方便：/inspect 1",
};

test("省略必須阻擋並保留來源、目前穿戴與版本", () => {
  const snapshot = new EquipmentSnapshot();
  snapshot.observe([message], 100000);
  const result = snapshot.evaluate(undefined, 100001);
  expect(result.completeness).toEqual({
    declared: 2,
    listed: 1,
    complete: false,
  });
  expect(result.source?.revision).toBe(message.revision);
  expect(result.current[0].id).toBe(1);
  expect(result.applicable).toBe(false);
  expect(result.recommendations).toEqual([]);
  snapshot.observe([message], 100002);
  expect(snapshot.evaluate(undefined, 100003).version).toBe(result.version);
});

test("inspect 依唯一名稱與新背包編號綁定；重複觀測不改版本", () => {
  const snapshot = new EquipmentSnapshot();
  const bag = {
    ...message,
    text: "🎒 背包（1 種）：\n  1. 護甲 【裝備中】— 防禦 +6\n🔢 用編號最方便：/inspect 1",
  };
  const inspect = {
    ...message,
    id: 2,
    text: "護甲\n類型：防具（身體槽）\n屬性：DEF +6",
  };
  snapshot.observe([bag], 100000);
  snapshot.observe([inspect], 100000, "/inspect 1");
  const first = snapshot.evaluate(undefined, 100000);
  expect(first.inspectSources).toHaveLength(1);
  snapshot.observe([inspect], 100000, "/inspect 1");
  expect(snapshot.evaluate(undefined, 100000).version).toBe(first.version);
  snapshot.observe(
    [
      {
        ...bag,
        id: 3,
        text: bag.text
          .replace("1 種", "2 種")
          .replace("\n🔢", "\n  2. 護甲 — 防禦 +6\n🔢"),
      },
    ],
    100000,
  );
  snapshot.observe([{ ...inspect, id: 4 }], 100000, "/inspect 1");
  expect(snapshot.evaluate(undefined, 100000).inspectSources).toEqual([]);
});

test("原始背包與 inspect 經快照合併，保留漏列敏捷與來源", () => {
  const snapshot = new EquipmentSnapshot();
  snapshot.observe(
    [
      {
        ...message,
        text: "🎒 背包（1 種）：\n  1. 護符 — INT +10、防禦 +4、敏捷 +3（Lv15 可裝備）\n🔢 用編號最方便：/inspect 1",
      },
    ],
    100000,
  );
  snapshot.observe(
    [
      {
        ...message,
        id: 2,
        text: "護符\n類型：防具（飾品槽）\n需求等級：Lv15　✅ 可裝備（你 Lv24）\n屬性：DEF +4　INT +10",
      },
    ],
    100000,
    "/inspect 1",
  );
  const result = snapshot.evaluate(undefined, 100000);
  expect(result.attributeEvidence[0]).toMatchObject({
    itemId: 1,
    values: { defense: 4, intelligence: 10, agility: 3 },
    missing: ["attack"],
    stats: null,
  });
  expect(result.inspectSources[0].messageId).toBe(2);
  expect(result.applicable).toBe(false);
  expect(result.recommendations).toEqual([]);
});

test("舊分支延遲回覆不得恢復快照", () => {
  const snapshot = new EquipmentSnapshot();
  const generation = snapshot.generation;
  snapshot.reset();
  snapshot.observe([message], 100000, undefined, generation);
  expect(snapshot.evaluate().source).toBeNull();
});

test("角色改變清空舊背包，多訊息不拼湊未知分頁", () => {
  const snapshot = new EquipmentSnapshot();
  const status = (id: number, name: string): GameMessage => ({
    ...message,
    id,
    text: `${name} 法熊 Lv22\nHP：10/10 MP：10/10\nEXP：1/100\n位置：村莊`,
  });
  snapshot.observe([status(1, "甲"), { ...message, id: 2 }], 100000);
  expect(snapshot.evaluate(undefined, 100000).character?.title).toContain("甲");
  snapshot.observe([status(3, "乙")], 100000);
  expect(snapshot.evaluate(undefined, 100000).source).toBeNull();
  snapshot.observe(
    [
      { ...message, id: 4 },
      { ...message, id: 5, text: "第二頁\n2. 物品 — 防禦 +1" },
    ],
    100000,
  );
  expect(snapshot.evaluate(undefined, 100000).completeness?.complete).toBe(
    false,
  );
});

test("編輯更新、過期、重設與外部變更失效", () => {
  const snapshot = new EquipmentSnapshot();
  snapshot.observe([message], 100000);
  const first = snapshot.evaluate(undefined, 100000).version;
  snapshot.observe([{ ...message, revision: "b".repeat(64) }], 100001);
  expect(snapshot.evaluate(undefined, 100001).version).toBeGreaterThan(first);
  expect(snapshot.evaluate(undefined, 500000).blockers).toContain(
    "背包觀測過期。",
  );
  snapshot.invalidate();
  expect(snapshot.evaluate(undefined, 100002).blockers).toContain(
    "觀測已失效，須重新查詢。",
  );
  snapshot.reset();
  expect(snapshot.evaluate().source).toBeNull();
  expect(new EquipmentSnapshot().evaluate().source).toBeNull();
});
