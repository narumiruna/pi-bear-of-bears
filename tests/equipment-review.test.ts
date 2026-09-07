import { expect, test } from "vitest";
import {
  type EquipmentCandidate,
  optimizeEquipment,
} from "../src/equipment-optimizer.js";
import { EquipmentSnapshot } from "../src/equipment-snapshot.js";
import type { GameMessage } from "../src/game.js";

function msg(id: number, text: string, outgoing = false): GameMessage {
  return {
    id,
    text,
    outgoing,
    date: 100,
    revision: String(id).padStart(64, "0"),
    buttons: [],
    hasMedia: false,
  };
}
function bag() {
  return msg(
    2,
    "🎒 背包（2 種）：\n  1. 護甲 — DEF +4\n  2. 藥水 — 恢復 HP\n🔢 用編號最方便：/inspect 1",
  );
}
const armor = (id: number) =>
  msg(id, "護甲\n類型：防具（身體槽）\n屬性：DEF +4");

test("R1：watch inspect 回聲不清除已收集的其他物品", () => {
  const s = new EquipmentSnapshot();
  s.observe([bag()], 100000);
  s.observe([armor(4)], 100000, "/inspect 1");
  s.observeLive([msg(5, "/inspect 2", true)]);
  s.observeLive([msg(6, "藥水\n類型：消耗品")]);
  expect(
    s.evaluate(undefined, 100000).inspectSources.map((x) => x.itemId),
  ).toEqual([1, 2]);
  s.observe([msg(6, "藥水\n類型：消耗品")], 100000, "/inspect 2");
  expect(s.evaluate(undefined, 100000).inspectSources).toHaveLength(2);
  s.observeLive([msg(7, "/equip 1", true)]);
  expect(s.evaluate(undefined, 100000).inspectSources).toEqual([]);
  expect(s.evaluate(undefined, 100000).applicable).toBe(false);
});

test("R1：watch 缺訊息或不明活動仍失效", () => {
  for (const omitted of [0, 1]) {
    const s = new EquipmentSnapshot();
    s.observe([bag()], 100000);
    s.observe([armor(4)], 100000, "/inspect 1");
    s.observeLive([msg(5, "未知活動")], omitted);
    expect(s.evaluate(undefined, 100000).inspectSources).toEqual([]);
  }
});

test("R4：同頁或跨頁 history 綁定延遲 inspect，不需要重送", () => {
  for (const split of [false, true]) {
    const s = new EquipmentSnapshot();
    s.observe([bag()], 100000);
    const request = msg(3, "/inspect 1", true);
    if (split) {
      s.observe([request], 100000);
      s.observe([armor(4)], 100000);
    } else s.observe([request, armor(4)], 100000);
    expect(s.evaluate(undefined, 100000).inspectSources[0]?.messageId).toBe(4);
  }
});

test("R4：插入命令、reset、換包與名稱不符拒絕綁定", () => {
  for (const action of ["command", "reset", "bag", "name", "unrelated"]) {
    const s = new EquipmentSnapshot();
    s.observe([bag(), msg(3, "/inspect 1", true)], 100000);
    if (action === "command") s.observe([msg(4, "/equip 1", true)], 100000);
    if (action === "unrelated") s.observe([msg(4, "其他事件")], 100000);
    if (action === "reset") s.reset();
    if (action === "bag") s.observe([{ ...bag(), id: 4 }], 100000);
    s.observe(
      [action === "name" ? msg(5, "其他護甲\n類型：防具（身體槽）") : armor(5)],
      100000,
    );
    expect(s.evaluate(undefined, 100000).inspectSources).toEqual([]);
  }
});

test("R2：明確非裝備保留清單完整性但不成為候選，未知類型仍阻擋", () => {
  for (const type of ["消耗品", "材料", "未知"]) {
    const s = new EquipmentSnapshot();
    s.observe([bag()], 100000);
    s.observe([msg(4, `藥水\n類型：${type}`)], 100000, "/inspect 2");
    const result = s.evaluate(undefined, 100000);
    expect(result.completeness?.complete).toBe(true);
    expect(result.excludedItems).toHaveLength(type === "未知" ? 0 : 1);
    expect(result.attributeEvidence.some((x) => x.itemId === 2)).toBe(
      type === "未知",
    );
    expect(result.blockers.some((x) => x.startsWith("物品 2"))).toBe(
      type === "未知",
    );
  }
});

test("R2：穿戴標記與非裝備型別矛盾不得略過", () => {
  const s = new EquipmentSnapshot();
  s.observe(
    [{ ...bag(), text: bag().text.replace("藥水 —", "藥水 【裝備中】—") }],
    100000,
  );
  s.observe([msg(4, "藥水\n類型：消耗品")], 100000, "/inspect 2");
  expect(s.evaluate(undefined, 100000).excludedItems).toEqual([]);
});

function item(
  id: number,
  attack: number,
  effects: string[] | null,
  equipped = false,
): EquipmentCandidate {
  return {
    id,
    name: String(id),
    stats: { attack, defense: 0, intelligence: 0, agility: 0 },
    effects,
    equipped,
    eligible: true,
    slot: "武器",
  };
}
test("R5 同型態：不可識別的最高分不遮蔽唯一安全次高分", () => {
  const high = item(2, 3, []);
  const result = optimizeEquipment(
    [item(1, 1, [], true), high, { ...high, id: 4 }, item(3, 2, [])],
    { slots: ["武器"] },
  );
  expect(result.recommendations[0]?.targetId).toBe(3);
  expect(result.excludedCandidates).toHaveLength(2);
});

test("R5：已知效果不相容的最高分不得遮蔽安全次高分", () => {
  const items = [item(1, 1, [], true), item(2, 3, ["技能"]), item(3, 2, [])];
  const result = optimizeEquipment(items, { slots: ["武器"] });
  expect(result.recommendations[0]?.targetId).toBe(3);
  expect(result.excludedCandidates[0]?.itemId).toBe(2);
  expect(result.predictedScore).toBe(2);
  expect(
    optimizeEquipment(items, { slots: ["武器"], ignoreEffects: true })
      .recommendations[0]?.targetId,
  ).toBe(2);
  items[1].effects = null;
  expect(optimizeEquipment(items, { slots: ["武器"] }).recommendations).toEqual(
    [],
  );
});
