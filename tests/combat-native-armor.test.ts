import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { parseCombatEvents } from "../src/combat-events.js";

const receipts = JSON.parse(
  readFileSync(
    new URL("./fixtures/native-combat-795245-795247.json", import.meta.url),
    "utf8",
  ),
) as {
  id: number;
  date: number;
  revision: string;
  originalSourceId: string;
  text: string;
}[];
const parse = (index: number, text = receipts[index].text) => {
  const row = receipts[index];
  return parseCombatEvents(text, {
    messageId: row.id,
    date: row.date,
    revision: row.revision,
    originalSourceId: row.originalSourceId,
    observedAt: row.date * 1000,
  });
};

test("795245裂甲與蠻力衝撞只保留觀測，不推倍率、敵DEF或首次實補", () => {
  const result = parse(0);
  expect(result).toMatchObject({
    complete: true,
    outcome: "ongoing",
    target: "裂界·荒原巨角獸",
    riskVerified: false,
    issues: [],
    unknownLines: [],
  });
  expect(
    result.events.find((event) => event.kind === "armor_reduction"),
  ).toMatchObject({ nominal: { value: 40, basis: "observed" } });
  expect(
    result.events.find((event) => event.kind === "healing")?.actual,
  ).toEqual({ value: null, basis: "unknown" });
  expect(
    result.events.find((event) => event.kind === "counter")?.actual?.value,
  ).toBe(191);
  expect(result.shield).toBeNull();
});

test("795247裂甲後正式勝才計3692G；不跨訊息推本手實傷或實補", () => {
  const result = parse(1);
  expect(result).toMatchObject({
    complete: true,
    outcome: "won",
    target: "裂界·荒原巨角獸",
    rewardGold: { value: 3692, basis: "observed" },
    riskVerified: false,
  });
  for (const kind of ["damage", "healing"]) {
    expect(result.events.find((event) => event.kind === kind)?.actual).toEqual({
      value: null,
      basis: "unknown",
    });
  }
});

test("裂甲數字、目標、先機缺段、結算後事件及未知衝撞格式仍封閉失敗", () => {
  for (const text of [
    receipts[1].text.replace("累計 −80", "累計 −39"),
    receipts[1].text.replace("累計 −80", "累計 −8,0"),
    receipts[1].text.replace("累計 −80", "累計 −9007199254740992"),
    receipts[1].text.replace("防禦 −40", "防禦 −4,0"),
    receipts[1].text.replace("防禦 −40", "防禦 −9007199254740992"),
    receipts[1].text.replace("防禦 −40", "防禦 -40"),
    receipts[1].text.replace("⚒️ 裂甲！裂界·荒原巨角獸", "⚒️ 裂甲！其他王"),
    receipts[1].text.replace(
      "⚒️ 裂甲！",
      "💨 裂界·荒原巨角獸 搶得先機！\n⚒️ 裂甲！",
    ),
    `${receipts[1].text}\n⚒️ 裂甲！裂界·荒原巨角獸 防禦 −40（累計 −80）`,
    receipts[1].text.replace(/^💀.*\n/mu, ""),
    receipts[0].text.replace("蠻力衝撞！傷害大增。", "蠻力衝撞！傷害翻倍。"),
    receipts[0].text.replace("💥 裂界·荒原巨角獸", "💥 其他王"),
  ]) {
    const result = parse(1, text);
    expect(result.outcome, text).not.toBe("won");
    expect(result.rewardGold.value, text).toBeNull();
    expect(result.riskVerified).toBe(false);
    if (!text.includes("倒下！") && !text.includes("蠻力衝撞")) {
      continue; // 無正式結算即使格式完整也不算勝。
    }
    expect(result.complete, text).toBe(false);
  }
});
