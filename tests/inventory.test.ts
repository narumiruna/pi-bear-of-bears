import { expect, test } from "vitest";
import type { GameMessage } from "../src/game.js";
import {
  isExplicitNonEquipmentEntry,
  parseExplicitAttributes,
  parseInspect,
  parseInventory,
  parseInventoryEquipmentFacts,
} from "../src/inventory.js";

function message(text: string): GameMessage {
  return {
    id: 1,
    date: 1,
    revision: "a".repeat(64),
    outgoing: false,
    text,
    buttons: [],
    hasMedia: false,
  };
}
test("明確四軸屬性含強化後值，不接受百分比、指數、重複或未列屬性", () => {
  expect(parseExplicitAttributes("ATK +10、DEF +20、INT -3、AGI +0")).toEqual({
    attack: 10,
    defense: 20,
    intelligence: -3,
    agility: 0,
  });
  for (const text of [
    "DEF +20",
    "ATK +1e3 DEF +2 INT +3 AGI +4",
    "ATK +1% DEF +2 INT +3 AGI +4",
    "ATK +1 DEF +2 INT +3 AGI +4 ATK +2",
    "ATK +1 DEF +2 INT +3 AGI +4（強化 +2）",
  ]) {
    expect(parseExplicitAttributes(text)).toBeNull();
  }
});

const footer = "\n🔢 用編號最方便：/equip 3、/use 1、/inspect 5";

test("保留遊戲編號、重名、堆疊、穿戴及描述，不猜部位", () => {
  const result = parseInventory(
    message(
      "🎒 背包（2 種）：\n  1. 🛡️粗木護甲 x2 【裝備中】— 防禦 +6（Lv1 可裝備）\n  2. 🛡️粗木護甲 — 防禦 +6（Lv1 可裝備）" +
        footer,
    ),
  );
  expect(result?.complete).toBe(true);
  expect(result?.entries[0]).toMatchObject({
    id: 1,
    count: 2,
    equipped: true,
    name: "🛡️粗木護甲",
  });
  expect(result?.entries[1].name).toBe(result?.entries[0].name);
});

test("全列格式與已確認的清單尾資訊可形成完整背包", () => {
  const result = parseInventory(
    message(
      "🎒 背包（2 種，全列）：\n  1. 法杖 【裝備中】— INT +10（Lv1 可裝備）\n  2. 護甲 — 防禦 +6（Lv1 可裝備）\n金幣：123 🪙" +
        footer +
        "\n🔒 /lock 編號 鎖定要保留的",
    ),
  );
  expect(result).toMatchObject({ total: 2, listed: 2, complete: true });
});

test("明確恢復格式可辨識為非裝備，未知描述仍不猜測", () => {
  expect(
    isExplicitNonEquipmentEntry({
      id: 61,
      name: "🍯蜂蜜糖漿",
      count: 5,
      equipped: false,
      description: "恢復 30 HP",
    }),
  ).toBe(true);
  expect(
    isExplicitNonEquipmentEntry({
      id: 62,
      name: "未知道具",
      count: 1,
      equipped: false,
      description: "神秘效果",
    }),
  ).toBe(false);
});

test("標準裝備列可確認部位、資格及稀疏屬性的零值", () => {
  const facts = parseInventoryEquipmentFacts({
    id: 7,
    name: "🟠⚡不朽秘銀咒刃",
    count: 2,
    equipped: false,
    description: "攻擊 +47、INT +29（Lv47 可裝備・詞條裝）",
  });
  expect(facts).toEqual({
    slot: "武器槽",
    eligible: true,
    requiredLevel: 47,
    stats: { attack: 47, defense: 0, intelligence: 29, agility: 0 },
    inferredZeros: ["defense", "agility"],
    effects: [],
  });
  expect(
    parseInventoryEquipmentFacts({
      id: 1,
      name: "特殊神器",
      count: 1,
      equipped: false,
      description: "攻擊 +99（Lv1 可裝備）",
    }),
  ).toBeUndefined();
});

test("遊戲端 41 種僅列 40 種不得宣稱完整", () => {
  const rows = Array.from(
    { length: 40 },
    (_, index) => `  ${index + 1}. 裝備${index + 1} — 防禦 +6（Lv1 可裝備）`,
  ).join("\n");
  const result = parseInventory(
    message(
      `🎒 背包（41 種）：\n${rows}\n…另有 1 種（共 1 件）較弱的裝備未列出` +
        footer,
    ),
  );
  expect(result).toMatchObject({ total: 41, listed: 40, complete: false });
});

test("缺頁、重複編號、未知格式、截斷均不能補成完整", () => {
  for (const text of [
    `🎒 背包（2 種）：\n  1. 物品 — 未知${footer}`,
    `🎒 背包（2 種）：\n  1. 甲 — 未知\n  1. 乙 — 未知${footer}`,
    `🎒 背包（1 種）：\n  1. 無分隔欄位${footer}`,
    "🎒 背包（1 種）：\n  1. 甲 — 未知",
    `🎒 背包（0 種）：\n下一頁${footer}`,
  ]) {
    expect(parseInventory(message(text))?.complete).toBe(false);
  }
  expect(parseInventory(message("其他格式"))).toBeUndefined();
});

test("inspect 只保留已確認欄位，強化及技能描述不遺失或猜零", () => {
  const text =
    "🔵🛡️祕製青銅護甲\n稀有度：🔵稀有\n類型：防具（身體槽）\n需求等級：Lv15　✅ 可裝備（你 Lv22）\n屬性：DEF +20\n強化說明：測試未知格式\n被動：測試效果";
  expect(parseInspect(message(text))).toMatchObject({
    slot: "身體槽",
    eligible: true,
    attributes: "DEF +20",
    effects: null,
    description: text,
  });
  expect(
    parseInspect(message(text.replace("（身體槽）", "")))?.slot,
  ).toBeNull();
  expect(parseInspect(message("藥水\n類型：消耗品"))?.slot).toBeNull();
  expect(parseInspect({ ...message(text), outgoing: true })).toBeUndefined();
});
