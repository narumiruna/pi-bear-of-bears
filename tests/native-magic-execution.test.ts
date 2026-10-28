import { expect, test } from "vitest";
import { parseCombatEvents } from "../src/combat-events.js";

// 845024 正式回執；只驗格式覆蓋，不驗證傷害公式或未來處決安全。
const receipt = `✨ 使用技能：湮滅法陣（MP -46）
☠️ 斬殺！霜寂·冰縛女妖 命懸一線，傷害爆增！
（斬殺超過 30,160 的部分折半計算，無硬上限）
⚒️ 裂甲！霜寂·冰縛女妖 防禦 −69（累計 −414）
造成 33939 點傷害！❄️ HP：0/75400

💀 霜寂·冰縛女妖 倒下！EXP +151000  金幣 +26,253

💠 進階素材：王之精魄 ×1
✨✨ 稀有掉落！🌠 星核碎晶（墜星核心剝落的結晶，內裡有微光緩慢旋轉。保存起來——聽說神社的巫熊正在研究它的用途。）
💠 進階素材：王之精魄 ×1
🧩 冰縛靈紗 碎片 ×1（1/20）
🧩 絕世冰縛頭冠 碎片 ×1（4/40）
🧩 絕世冰縛秘環 碎片 ×1（4/40）`;
const parse = (text = receipt) =>
  parseCombatEvents(text, {
    messageId: 845024,
    date: 1793187663,
    observedAt: 1793187663000,
    revision:
      "def4e35be804b84e270588ed81f319cb1764b89e23db4619cc66c8bb64439f74",
    originalSourceId: "cc86e836-1a03-4ce0-956c-190519a5904c",
  });

test("845024處決軟上限註記不阻擋正式收益，不轉成計算或安全效果", () => {
  const result = parse();
  expect(result).toMatchObject({
    complete: true,
    outcome: "won",
    target: "霜寂·冰縛女妖",
    rewardGold: { value: 26253 },
    unknownLines: [],
    riskVerified: false,
    shield: null,
  });
  expect(
    result.events
      .filter((event) => event.kind === "effect")
      .map((event) => event.description),
  ).toEqual(receipt.split("\n").slice(1, 3));
  expect(result.events.find((event) => event.kind === "damage")).toMatchObject({
    nominal: { value: 33939 },
    actual: { value: null },
  });
  expect(
    result.events.filter((event) => event.kind === "reward_item"),
  ).toHaveLength(6);
});

test.each([
  receipt.replace("☠️ 斬殺！霜寂·冰縛女妖", "☠️ 斬殺！其他王"),
  receipt.replace("30,160", "9007199254740992"),
  receipt.replace("無硬上限", "硬上限"),
  receipt.replace("折半計算", "全部減免"),
  `${receipt}\n未知獎勵999G`,
])("未知註記、目標矛盾或溢位仍不批准收益", (text) => {
  expect(parse(text)).toMatchObject({
    complete: false,
    outcome: "unknown",
    rewardGold: { value: null },
    riskVerified: false,
  });
});
