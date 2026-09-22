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
  snapshot.observe([message], 100_000);
  const result = snapshot.evaluate(undefined, 100_001);
  expect(result.completeness).toEqual({
    declared: 2,
    listed: 1,
    complete: false,
  });
  expect(result.source?.revision).toBe(message.revision);
  expect(result.current[0].id).toBe(1);
  expect(result.applicable).toBe(false);
  expect(result.recommendations).toEqual([]);
  snapshot.observe([message], 100_002);
  expect(snapshot.evaluate(undefined, 100_003).version).toBe(result.version);
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
  snapshot.observe([bag], 100_000);
  snapshot.observe([inspect], 100_000, "/inspect 1");
  const first = snapshot.evaluate(undefined, 100_000);
  expect(first.inspectSources).toHaveLength(1);
  snapshot.observe([inspect], 100_000, "/inspect 1");
  expect(snapshot.evaluate(undefined, 100_000).version).toBe(first.version);
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
    100_000,
  );
  snapshot.observe([{ ...inspect, id: 4 }], 100_000, "/inspect 1");
  expect(snapshot.evaluate(undefined, 100_000).inspectSources).toEqual([]);
});

test("inspect 明確標示無法裝備的材料時排除候選", () => {
  const snapshot = new EquipmentSnapshot();
  snapshot.observe(
    [
      {
        ...message,
        text: "🎒 背包（1 種，全列）：\n  1. 星核碎晶 x41 — 墜星核心剝落的結晶\n🔢 用編號最方便：/inspect 1",
      },
    ],
    100_000,
  );
  snapshot.observe(
    [
      {
        ...message,
        id: 2,
        text: "星核碎晶\n類型：材料（無法裝備）\n用途：鍛造材料",
      },
    ],
    100_000,
    "/inspect 1",
  );
  const result = snapshot.evaluate(undefined, 100_000);
  expect(result.excludedItems).toEqual([
    { itemId: 1, reason: "inspect 明確標示非裝備。" },
  ]);
  expect(result.attributeEvidence).toEqual([]);
  expect(result.blockers).not.toContain("物品 1：inventory 屬性格式無法確認。");
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
    100_000,
  );
  snapshot.observe(
    [
      {
        ...message,
        id: 2,
        text: "護符\n類型：防具（飾品槽）\n需求等級：Lv15　✅ 可裝備（你 Lv24）\n屬性：DEF +4　INT +10",
      },
    ],
    100_000,
    "/inspect 1",
  );
  const result = snapshot.evaluate(undefined, 100_000);
  expect(result.attributeEvidence[0]).toMatchObject({
    itemId: 1,
    values: { attack: 0, defense: 4, intelligence: 10, agility: 3 },
    missing: [],
    inferredZeros: ["attack"],
    stats: { attack: 0, defense: 4, intelligence: 10, agility: 3 },
  });
  expect(result.inspectSources[0].messageId).toBe(2);
  expect(result.applicable).toBe(false);
  expect(result.recommendations).toEqual([]);
});

test("inspect 的完整屬性列可補齊 BOSS 裝未列出的零值", () => {
  const snapshot = new EquipmentSnapshot();
  snapshot.observe(
    [
      {
        ...message,
        id: 1,
        text: "甲 元素熊 Lv157\nHP：1182/1182 MP：1660/1660\nEXP：1/100\n位置：孢子母巢",
      },
      {
        ...message,
        id: 2,
        revision: "b".repeat(64),
        text:
          "🎒 背包（3 種，全列）：\n" +
          "  1. 🟠🪄不朽龍骨法杖 【裝備中】— INT +124（Lv61 可裝備）\n" +
          "  2. 🔵🪄祕製永恆法杖 — INT +162（Lv85 可裝備）\n" +
          "  3. 🟠🐍濕地毒杖 — 攻擊 +140（BOSS 掉落）\n" +
          "金幣：123 🪙\n" +
          "🔢 用編號最方便：/inspect 1",
      },
    ],
    100_000,
  );
  snapshot.observe(
    [
      {
        ...message,
        id: 3,
        text:
          "🟠🐍濕地毒杖\n" +
          "類型：武器（武器槽）\n" +
          "需求等級：Lv1　✅ 可裝備（你 Lv157）\n" +
          "屬性：ATK +140",
      },
    ],
    100_000,
    "/inspect 3",
  );

  const result = snapshot.evaluate(
    { attack: 1, defense: 1, intelligence: 2, agility: 1 },
    100_000,
  );
  expect(result.blockers).toEqual([]);
  expect(result.attributeEvidence[2]).toMatchObject({
    itemId: 3,
    missing: [],
    inferredZeros: ["defense", "intelligence", "agility"],
    stats: { attack: 140, defense: 0, intelligence: 0, agility: 0 },
  });
  expect(result.recommendations).toEqual([
    {
      slot: "武器槽",
      currentId: 1,
      targetId: 2,
      currentScore: 248,
      targetScore: 324,
      delta: 76,
    },
  ]);
});

test("inspect 可取代混有技能文字的背包屬性摘要", () => {
  const snapshot = new EquipmentSnapshot();
  snapshot.observe(
    [
      {
        ...message,
        id: 1,
        text: "甲 劍聖熊 二轉Lv70\nHP：100/100 MP：50/50\nEXP：滿級\n位置：枯木沼",
      },
      {
        ...message,
        id: 2,
        revision: "b".repeat(64),
        text:
          "🎒 背包（2 種，全列）：\n" +
          "  1. 巨劍 【裝備中】— 攻擊 +267（Lv89 可裝備）\n" +
          "  2. 孢子法杖 — INT +110，習得〔孢子爆發〕\n" +
          "金幣：123 🪙\n" +
          "🔢 用編號最方便：/inspect 1",
      },
    ],
    100_000,
  );
  snapshot.observe(
    [
      {
        ...message,
        id: 3,
        text:
          "孢子法杖\n" +
          "類型：武器（武器槽）\n" +
          "需求等級：Lv1　✅ 可裝備（你 Lv170）\n" +
          "屬性：INT +110\n" +
          "✨ 賦予技能〔孢子爆發〕：INT×1.6 傷害",
      },
    ],
    100_000,
    "/inspect 2",
  );

  const result = snapshot.evaluate(
    { attack: 2, defense: 1, intelligence: 0, agility: 1 },
    100_000,
  );
  expect(result.attributeEvidence[1]).toMatchObject({
    itemId: 2,
    missing: [],
    inferredZeros: ["attack", "defense", "agility"],
    stats: { attack: 0, defense: 0, intelligence: 110, agility: 0 },
  });
  expect(result.blockers).toEqual(["物品 2 有未確認的技能／被動／套裝效果。"]);
});

test("舊分支延遲回覆不得恢復快照", () => {
  const snapshot = new EquipmentSnapshot();
  const generation = snapshot.generation;
  snapshot.reset();
  snapshot.observe([message], 100_000, undefined, generation);
  expect(snapshot.evaluate().source).toBeNull();
});

test("只拼接有全列標記且連續的多訊息背包", () => {
  const snapshot = new EquipmentSnapshot();
  snapshot.observeLive([
    {
      ...message,
      id: 2,
      outgoing: true,
      text: "/inventory all",
    },
  ]);
  snapshot.observeLive([
    {
      ...message,
      id: 3,
      text: "🎒 背包（2 種，全列）：\n  1. 法杖 【裝備中】— INT +10",
    },
  ]);
  expect(snapshot.evaluate(undefined, 100_000).source).toBeNull();
  snapshot.observeLive([
    {
      ...message,
      id: 4,
      revision: "b".repeat(64),
      text: "2. 護甲 — 防禦 +6\n金幣：123 🪙\n🔢 用編號最方便：/inspect 1\n🔒 /lock 編號 鎖定要保留的",
    },
  ]);
  const result = snapshot.evaluate(undefined, 100_000);
  expect(result.completeness).toEqual({
    declared: 2,
    listed: 2,
    complete: true,
  });
  expect(result.source).toMatchObject({
    messageId: 4,
    revision: "b".repeat(64),
  });
  expect(result.current).toHaveLength(1);
});

test("先收到背包續行時不會讓稍後補齊的完整回覆失效", () => {
  const snapshot = new EquipmentSnapshot();
  const status = {
    ...message,
    id: 1,
    text: "甲 道熊 Lv74\nHP：840/840 MP：518/518\nEXP：1/100\n位置：村莊",
  };
  snapshot.observe([status], 100_000);
  snapshot.observeLive([
    { ...message, id: 2, outgoing: true, text: "/inventory all" },
  ]);
  snapshot.observeLive([
    {
      ...message,
      id: 4,
      text: "2. 護甲 — 防禦 +6\n金幣：123 🪙\n🔢 用編號最方便：/inspect 1",
    },
  ]);
  snapshot.observe(
    [
      {
        ...message,
        id: 3,
        text: "🎒 背包（2 種，全列）：\n  1. 法杖 【裝備中】— INT +10",
      },
      {
        ...message,
        id: 4,
        revision: "b".repeat(64),
        text: "2. 護甲 — 防禦 +6\n金幣：123 🪙\n🔢 用編號最方便：/inspect 1",
      },
    ],
    100_000,
    "/inventory all",
  );
  expect(
    snapshot
      .evaluate(undefined, 100_000)
      .blockers.filter((text) => /觀測已失效|角色狀態早於/.test(text)),
  ).toEqual([]);
});

test("完整背包完成後重播既有續行不會使角色狀態失效", () => {
  const snapshot = new EquipmentSnapshot();
  const status = {
    ...message,
    id: 1,
    text: "甲 道熊 Lv74\nHP：840/840 MP：518/518\nEXP：1/100\n位置：村莊",
  };
  const continuation = {
    ...message,
    id: 4,
    revision: "b".repeat(64),
    text: "2. 護甲 — 防禦 +6\n金幣：123 🪙\n🔢 用編號最方便：/inspect 1",
  };
  snapshot.observe(
    [
      status,
      { ...message, id: 2, outgoing: true, text: "/inventory all" },
      {
        ...message,
        id: 3,
        text: "🎒 背包（2 種，全列）：\n  1. 法杖 【裝備中】— INT +10",
      },
      continuation,
    ],
    100_000,
    "/inventory all",
  );

  snapshot.observeLive([continuation]);

  expect(
    snapshot
      .evaluate(undefined, 100_000)
      .blockers.filter((text) => /觀測已失效|角色狀態早於/.test(text)),
  ).toEqual([]);

  snapshot.observeLive([{ ...continuation, id: 5 }]);
  expect(snapshot.evaluate(undefined, 100_000).blockers).toContain(
    "觀測已失效，須重新查詢。",
  );
});

test("完整標準背包列不需逐件 inspect 即可產生推薦", () => {
  const snapshot = new EquipmentSnapshot();
  snapshot.observe(
    [
      {
        ...message,
        id: 1,
        text: "甲 道熊 Lv74\nHP：840/840 MP：518/518\nEXP：1/100\n位置：村莊",
      },
      {
        ...message,
        id: 2,
        revision: "b".repeat(64),
        text:
          "🎒 背包（3 種，全列）：\n" +
          "  1. 🟢🪄精良龍骨法杖 【裝備中】— INT +67（Lv57 可裝備）\n" +
          "  2. 🟠⚡不朽秘銀咒刃 — 攻擊 +47、INT +29（Lv47 可裝備・詞條裝）\n" +
          "  3. 🍯蜂蜜糖漿 x5 — 恢復 30 HP\n" +
          "金幣：123 🪙\n" +
          "🔢 用編號最方便：/inspect 1\n" +
          "🔒 /lock 編號 鎖定要保留的",
      },
    ],
    100_000,
  );
  const result = snapshot.evaluate(undefined, 100_000);
  expect(result.applicable).toBe(true);
  expect(result.blockers).toEqual([]);
  expect(result.recommendations).toEqual([
    {
      slot: "武器槽",
      currentId: 1,
      targetId: 2,
      currentScore: 67,
      targetScore: 76,
      delta: 9,
    },
  ]);
  expect(result.attributeEvidence[1]).toMatchObject({
    itemId: 2,
    inferredZeros: ["defense", "agility"],
  });
  expect(result.excludedItems).toEqual([
    {
      itemId: 3,
      reason: "背包列明確符合已確認的消耗品格式。",
    },
  ]);
});

test("角色改變清空舊背包，多訊息不拼湊未知分頁", () => {
  const snapshot = new EquipmentSnapshot();
  const status = (id: number, name: string): GameMessage => ({
    ...message,
    id,
    text: `${name} 法熊 Lv22\nHP：10/10 MP：10/10\nEXP：1/100\n位置：村莊`,
  });
  snapshot.observe([status(1, "甲"), { ...message, id: 2 }], 100_000);
  expect(snapshot.evaluate(undefined, 100_000).character?.title).toContain(
    "甲",
  );
  snapshot.observe([status(3, "乙")], 100_000);
  expect(snapshot.evaluate(undefined, 100_000).source).toBeNull();
  snapshot.observe(
    [
      { ...message, id: 4 },
      { ...message, id: 5, text: "第二頁\n2. 物品 — 防禦 +1" },
    ],
    100_000,
  );
  expect(snapshot.evaluate(undefined, 100_000).completeness?.complete).toBe(
    false,
  );
});

test("編輯更新、過期、重設與外部變更失效", () => {
  const snapshot = new EquipmentSnapshot();
  snapshot.observe([message], 100_000);
  const first = snapshot.evaluate(undefined, 100_000).version;
  snapshot.observe([{ ...message, revision: "b".repeat(64) }], 100_001);
  expect(snapshot.evaluate(undefined, 100_001).version).toBeGreaterThan(first);
  expect(snapshot.evaluate(undefined, 500_000).blockers).toContain(
    "背包觀測過期。",
  );
  snapshot.invalidate();
  expect(snapshot.evaluate(undefined, 100_002).blockers).toContain(
    "觀測已失效，須重新查詢。",
  );
  snapshot.reset();
  expect(snapshot.evaluate().source).toBeNull();
  expect(new EquipmentSnapshot().evaluate().source).toBeNull();
});
