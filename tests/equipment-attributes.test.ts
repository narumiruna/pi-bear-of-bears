import { expect, test } from "vitest";
import { mergeEquipmentAttributes } from "../src/equipment-attributes.js";
import { parseEquipmentRefinement } from "../src/equipment-refinement.js";
import type { InventoryEntry } from "../src/inventory.js";

function entry(description: string): InventoryEntry {
  return { id: 10, name: "護符", equipped: false, count: 1, description };
}

test("refined evidence uses effective values and retains both literal pairs", () => {
  const item = {
    ...entry("攻擊 +518、防禦 +555（BOSS 進階）"),
    refinement: parseEquipmentRefinement(1, "ATK 518→539　DEF 555→577"),
  };
  const result = mergeEquipmentAttributes(
    item,
    "手甲\n屬性（精煉 +1）：ATK 518→539　DEF 555→577\n換上後：ATK -518 ⬇️",
  );
  expect(result.stats).toEqual({
    attack: 539,
    defense: 577,
    intelligence: 0,
    agility: 0,
  });
  expect(result.sources[0].refinement?.base).toEqual({
    attack: 518,
    defense: 555,
  });
  expect(result.sources[1].refinement?.effective).toEqual({
    attack: 539,
    defense: 577,
  });
});

test.each([
  "屬性（精煉 +2）：DEF 278→300",
  "屬性（精煉 +1）：DEF 279→300",
  "屬性（精煉 +1）：DEF 278→301",
  "屬性：DEF +278",
  "屬性（精煉 +6）：DEF 278→300",
  "屬性（精煉 +1）：DEF 278→300\n屬性：DEF +300",
  "屬性（精煉 +1）：DEF 278→300\n屬性（精煉 +1）：DEF 278→300",
])("mismatched or unknown refined evidence remains blocked: %s", (row) => {
  const item = {
    ...entry("防禦 +278"),
    refinement: parseEquipmentRefinement(1, "DEF 278→300"),
  };
  expect(mergeEquipmentAttributes(item, `頭冠\n${row}`).stats).toBeNull();
});

test("missing refined axes remain blocked, not overwritten with zeros", () => {
  const item = {
    ...entry("防禦 +314、敏捷 +500（BOSS 進階）"),
    refinement: parseEquipmentRefinement(5, "DEF 314→377　AGI 500→600"),
  };
  const result = mergeEquipmentAttributes(
    item,
    "靴\n屬性（精煉 +5）：DEF 314→377",
  );
  expect(result.values.agility).toBe(600);
  expect(result.stats).toBeNull();
  expect(result.inferredZeros).toEqual([]);
});

test("refined metadata cannot disagree with the plain inventory summary", () => {
  const item = {
    ...entry("防禦 +279"),
    refinement: parseEquipmentRefinement(1, "DEF 278→300"),
  };
  const result = mergeEquipmentAttributes(
    item,
    "頭冠\n屬性（精煉 +1）：DEF 278→300",
  );
  expect(result.diagnostics).toContain("inventory 精煉基值與屬性摘要不一致。");
  expect(result.stats).toBeNull();
});

test("已觀察的護符：保留背包敏捷，不用 inspect 缺項覆蓋或補零", () => {
  const result = mergeEquipmentAttributes(
    entry("INT +10、防禦 +4、敏捷 +3（Lv15 可裝備）"),
    "護符\n屬性：DEF +4　INT +10",
  );
  expect(result.values).toEqual({ defense: 4, intelligence: 10, agility: 3 });
  expect(result.missing).toEqual(["attack"]);
  expect(result.stats).toBeNull();
  expect(result.sources.map((source) => source.kind)).toEqual([
    "inventory",
    "inspect",
  ]);
});

test("完整標準背包列可將未列四軸視為零", () => {
  const result = mergeEquipmentAttributes(
    entry("攻擊 +47、INT +29（Lv47 可裝備・詞條裝）"),
    "",
    { inventorySparseComplete: true },
  );
  expect(result.stats).toEqual({
    attack: 47,
    defense: 0,
    intelligence: 29,
    agility: 0,
  });
  expect(result.inferredZeros).toEqual(["defense", "agility"]);
  expect(result.diagnostics).toEqual([]);
});

test("已觀察的詞條武器：同值去重，不與背包總值相加", () => {
  const result = mergeEquipmentAttributes(
    entry("攻擊 +14、防禦 +6（Lv15 可裝備・詞條裝）"),
    "戰斧\n📿 詞條：\n　⟨鋒銳⟩ 攻擊 +14\n　⟨堅壁⟩ 防禦 +6",
  );
  expect(result.values).toEqual({ attack: 14, defense: 6 });
  expect(
    result.sources.filter((source) => source.kind === "affix"),
  ).toHaveLength(2);
  expect(result.stats).toBeNull();
});

test("合成完整四軸可合併；明確零與未列屬性有別", () => {
  const result = mergeEquipmentAttributes(
    entry("ATK +0、DEF +4"),
    "護符\n屬性：DEF +4、INT +10、AGI +3",
  );
  expect(result.stats).toEqual({
    attack: 0,
    defense: 4,
    intelligence: 10,
    agility: 3,
  });
  expect(result.diagnostics).toEqual([]);
});

test("強化差值或來源衝突不任選來源，不默默相加", () => {
  const result = mergeEquipmentAttributes(
    entry("ATK +0、DEF +4、INT +10、AGI +3"),
    "護符\n屬性：DEF +6\n⟨堅壁⟩ 防禦 +2",
  );
  expect(result.conflicts).toEqual(["defense"]);
  expect(result.values.defense).toBeUndefined();
  expect(result.stats).toBeNull();
});

test("未知數值語法不能忽略後宣稱完整", () => {
  const result = mergeEquipmentAttributes(
    entry("ATK +0、DEF +4、INT +10、AGI +3"),
    "護符\n屬性：DEF +4%\n⟨未知⟩ 減傷 5%",
  );
  expect(result.stats).toBeNull();
  expect(result.diagnostics).toContain("inspect 屬性格式無法確認。");
  expect(result.diagnostics).toContain("affix 屬性格式無法確認。");
});
