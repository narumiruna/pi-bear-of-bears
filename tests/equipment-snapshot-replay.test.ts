import { expect, test } from "vitest";
import { EquipmentSnapshot } from "../src/equipment-snapshot.js";
import type { GameMessage } from "../src/game.js";

function msg(id: number, text: string, outgoing = false): GameMessage {
  return {
    id,
    text,
    outgoing,
    date: 100,
    revision: "a".repeat(64),
    buttons: [],
    hasMedia: false,
  };
}
const status = msg(
  1,
  "甲 陰陽熊 二轉Lv80\nHP：2120/2120 MP：1154/1154\nEXP：滿級\n位置：村莊",
);
const header = msg(
  3,
  "🎒 背包（3 種，全列）：\n  1. 🟠🪄不朽永恆法杖 【裝備中】— INT +246（Lv89 可裝備）",
);
const middle = msg(4, "2. 🟠❄️女妖冰晶法杖 — INT +600（BOSS 掉落）");
const footer = msg(
  5,
  "3. 🟠🛡️不朽永恆護甲 — 防禦 +256（Lv89 可裝備）\n🔢 用編號最方便：/inspect 1",
);

function snapshot() {
  const s = new EquipmentSnapshot();
  s.observe([status, msg(2, "/inventory all", true), header, middle], 100_000);
  return s;
}

test("完整背包尾頁抵達前重播中頁不重複累加物品", () => {
  const s = snapshot();
  s.observe([middle, footer], 100_000);
  expect(s.evaluate(undefined, 100_000).completeness).toEqual({
    declared: 3,
    listed: 3,
    complete: true,
  });
});

test("同一背包中頁新版取代舊版，不拼接兩個版本", () => {
  const s = snapshot();
  s.observe(
    [
      {
        ...middle,
        revision: "b".repeat(64),
        text: middle.text.replace("600", "601"),
      },
      footer,
    ],
    100_000,
  );
  const result = s.evaluate(undefined, 100_000);
  expect(result.completeness).toEqual({
    declared: 3,
    listed: 3,
    complete: true,
  });
  expect(
    result.attributeEvidence.find((x) => x.itemId === 2)?.values.intelligence,
  ).toBe(601);
});

test("唯一名稱inspect可透過request綁定特殊武器", () => {
  const s = snapshot();
  s.observe([footer], 100_000);
  s.observe(
    [
      msg(
        7,
        "🟠❄️女妖冰晶法杖\n類型：武器（武器槽）\n需求等級：Lv155　✅ 可裝備（你 Lv180）\n屬性：INT +600",
      ),
    ],
    100_000,
    "/inspect 女妖冰晶法杖",
  );
  expect(s.evaluate(undefined, 100_000).inspectSources).toEqual([
    { itemId: 2, messageId: 7, revision: "a".repeat(64), date: 100 },
  ]);
});

test("名稱inspect的outgoing回聲不使有效角色與背包失效", () => {
  const s = snapshot();
  s.observe([footer], 100_000);
  s.observe(
    [
      msg(6, "/inspect 女妖冰晶法杖", true),
      msg(
        7,
        "🟠❄️女妖冰晶法杖\n類型：武器（武器槽）\n需求等級：Lv155　✅ 可裝備（你 Lv180）\n屬性：INT +600",
      ),
    ],
    100_000,
  );
  const result = s.evaluate(undefined, 100_000);
  expect(result.blockers).toEqual(["武器槽 技能／被動資訊未知。"]);
  expect(result.inspectSources[0]).toMatchObject({ itemId: 2, messageId: 7 });
  expect(result.attributeEvidence.find((x) => x.itemId === 2)?.stats).toEqual({
    attack: 0,
    defense: 0,
    intelligence: 600,
    agility: 0,
  });
  expect(result.recommendations).toEqual([]);
});

test("去除emoji後重名的inspect不可猜測編號", () => {
  const s = new EquipmentSnapshot();
  s.observe(
    [
      status,
      msg(
        2,
        "🎒 背包（2 種，全列）：\n  1. 🟠❄️女妖冰晶法杖 — INT +600（BOSS 掉落）\n  2. 🔴❄️女妖冰晶法杖 — INT +601（BOSS 掉落）\n🔢 用編號最方便：/inspect 1",
      ),
    ],
    100_000,
  );
  s.observe(
    [msg(3, "🟠❄️女妖冰晶法杖\n類型：武器（武器槽）\n屬性：INT +600")],
    100_000,
    "/inspect 女妖冰晶法杖",
  );
  expect(s.evaluate(undefined, 100_000).inspectSources).toEqual([]);
});

function inspectedCurrentCharacter() {
  const s = new EquipmentSnapshot();
  s.observe(
    [
      {
        ...status,
        text: status.text.replace("甲 陰陽熊", "☯️ なるみ_陰陽熊　陰陽熊"),
      },
      msg(2, "/inventory all", true),
      header,
      middle,
      footer,
      msg(6, "/inspect 2", true),
      msg(
        7,
        "🟠❄️女妖冰晶法杖\n類型：武器（武器槽）\n需求等級：Lv155　✅ 可裝備（你 Lv180）\n屬性：INT +600",
      ),
    ],
    100_000,
  );
  return s;
}

test("明確他角小時戰報不清除目前角色已綁inspect", () => {
  const s = inspectedCurrentCharacter();
  const before = s.evaluate(undefined, 100_000);
  s.observeLive([
    msg(
      8,
      "【🍃 なるみ_風行熊】\n🐾 已掛機 1 天（本次結算 1 小時）\nEXP +931620　🪙 +112259",
    ),
  ]);
  const after = s.evaluate(undefined, 100_000);
  expect(after.inspectSources).toEqual(before.inspectSources);
  expect(after.blockers).toEqual(before.blockers);
  expect(after.completeness).toEqual(before.completeness);
});

test.each([
  "【☯️ なるみ_陰陽熊】\n🐾 掛機 17 分\nEXP +255360　🪙 +33808",
  "🐾 已掛機 1 小時\nEXP +255360　🪙 +33808",
  "【🍃 なるみ_風行熊】\n✅ 已裝備未知物品",
  "✅ 已切換為 🍃 なるみ_風行熊",
])("本角結算或未知活動仍失效：%s", (text) => {
  const s = inspectedCurrentCharacter();
  s.observe([msg(8, text)], 100_000);
  const result = s.evaluate(undefined, 100_000);
  expect(result.inspectSources).toEqual([]);
  expect(result.blockers).toContain("觀測已失效，須重新查詢。");
});

test("省略訊息與角色標題無法辨識時不略過他角戰報", () => {
  const text = "【🍃 なるみ_風行熊】\n🐾 已掛機 1 小時";
  const s = inspectedCurrentCharacter();
  s.observeLive([msg(8, text)], 1);
  expect(s.evaluate(undefined, 100_000).blockers).toContain(
    "觀測已失效，須重新查詢。",
  );
  const unknownName = snapshot();
  unknownName.observe([footer, msg(8, text)], 100_000);
  expect(unknownName.evaluate(undefined, 100_000).blockers).toContain(
    "觀測已失效，須重新查詢。",
  );
});
