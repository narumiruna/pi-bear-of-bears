import { expect, test } from "vitest";
import { mergeEquipmentAttributes } from "../src/equipment-attributes.js";
import type { InventoryEntry } from "../src/inventory.js";

function entry(description: string): InventoryEntry {
  return { id: 10, name: "護符", equipped: false, count: 1, description };
}

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
