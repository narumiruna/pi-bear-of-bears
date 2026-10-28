import { expect, test } from "vitest";
import { parseCombatEvents } from "../src/combat-events.js";

// 2026-10-28 本人原生回執；不是合成戰果或安全上界。
const ancient = `✨ 使用技能：蜂蜜火球（MP -20）
🟣 毒孢侵蝕！🌑 受到 1221 點持續傷害。HP：855/23900
（🔥越戰越勇+9%）
⚒️ 裂甲！遺忘古神 防禦 −40（累計 −160）
造成 4504 點傷害！🌑 HP：0/23900

💀 遺忘古神 倒下！EXP +24000  金幣 +8,443

🧩 絕世古神頭冠 碎片 ×1（1/40）
🧩 絕世古神秘環 碎片 ×1（1/40）
🧩 絕世殘影戰甲 碎片 ×1（1/40）`;
const abyss = `✨ 使用技能：靈魂汲取（MP -34）
🟣 毒孢侵蝕！🐙 受到 1221 點持續傷害。HP：10435/14500
（🔥越戰越勇+3%／🎯易傷+30%）
⚒️ 裂甲！深淵領主 防禦 −40（累計 −80）
造成 6675 點傷害！🐙 HP：3760/14500
👊 深淵領主 攻擊力降低 73 點！（現 ATK 417）
💥 爆擊追擊 +3338！🐙 HP：422/14500
⚡ 連擊追加 1598！🐙 HP：0/14500
🩸 吸血！恢復 5805 HP。HP：1500/1500

💀 深淵領主 倒下！EXP +12360  金幣 +2,939

💠 進階素材：王之精魄 ×1
🧩 絕世深淵頭冠 碎片 ×1（1/40）`;
const curse = `✨ 使用技能：亡者詛咒（MP -30）
🎯 深淵領主 被撕開破綻！接下來數回合受到的傷害 +30%
⚒️ 裂甲！深淵領主 防禦 −40（累計 −40）
造成 2844 點傷害！🐙 HP：11656/14500
👊 深淵領主 攻擊力降低 117 點！（現 ATK 490）
🟣 毒孢附著！接下來 3 回合每回合造成 1221 傷害。
🌀 你閃過了 深淵領主 的反擊！

🐙 反擊！你受到 0 傷害。HP：1500/1500`;
const parse = (text: string, messageId = 844370) =>
  parseCombatEvents(text, {
    messageId,
    revision: "observed-native-magic",
    date: 1793181546,
    observedAt: 1793181546000,
  });

test("844370 毒傷與越戰註記不阻擋正式勝報", () => {
  const result = parse(ancient);
  expect(result).toMatchObject({
    complete: true,
    outcome: "won",
    target: "遺忘古神",
    rewardGold: { value: 8443 },
    riskVerified: false,
    unknownLines: [],
  });
  expect(result.events.find((event) => event.kind === "dot")).toMatchObject({
    nominal: { value: 1221 },
    actual: { value: null },
  });
  expect(result.shield).toBeNull();
});

test("844394 保留名吸未知實補與降攻當次原文，不推效果或冷卻", () => {
  const result = parse(abyss, 844394);
  expect(result).toMatchObject({
    complete: true,
    outcome: "won",
    target: "深淵領主",
    rewardGold: { value: 2939 },
    riskVerified: false,
  });
  expect(result.events.find((event) => event.kind === "healing")).toMatchObject(
    { nominal: { value: 5805 }, actual: { value: null } },
  );
});

test("844392 詛咒效果只存原文，不推易傷或DOT耗次", () => {
  const result = parse(curse, 844392);
  expect(result).toMatchObject({
    complete: true,
    outcome: "ongoing",
    target: "深淵領主",
    riskVerified: false,
  });
  expect(result.shield).toBeNull();
});

test.each([
  ancient.replace("+9%", "+9007199254740992%"),
  ancient.replace("1221 點持續傷害", "未知 點持續傷害"),
  ancient.replace("（🔥越戰越勇+9%）", "（🔥越戰越勇+9%／未知加成）"),
  abyss.replace("現 ATK 417", "現 ATK 9007199254740992"),
  curse.replace("深淵領主 攻擊力降低", "另一目標 攻擊力降低"),
  `${ancient}\n未知獎勵 999G`,
])("未知註記、數值溢位或目標矛盾仍不計獎", (text) => {
  expect(parse(text)).toMatchObject({
    complete: false,
    outcome: "unknown",
    rewardGold: { value: null },
    riskVerified: false,
  });
});
