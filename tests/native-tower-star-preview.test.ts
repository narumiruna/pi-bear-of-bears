import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { parseCombatEvents } from "../src/combat-events.js";
import { nativeTowerReward } from "../src/combat-native-tower.js";

const receipt = JSON.parse(
  readFileSync(
    new URL("./fixtures/native-combat-844011.json", import.meta.url),
    "utf8",
  ),
) as {
  id: number;
  date: number;
  revision: string;
  originalSourceId: string;
  text: string;
};
const parse = (text = receipt.text) =>
  parseCombatEvents(text, {
    messageId: receipt.id,
    date: receipt.date,
    revision: receipt.revision,
    originalSourceId: receipt.originalSourceId,
    observedAt: receipt.date * 1000,
  });

test("844011正式49的50星主預覽只保存原文，不當成當前戰鬥效果", () => {
  const result = parse();
  expect(result).toMatchObject({
    complete: true,
    outcome: "won",
    target: "星影·冥界守衛",
    riskVerified: false,
    unknownLines: [],
    issues: [],
  });
  expect(nativeTowerReward(result)).toMatchObject({
    floor: 49,
    repeatable: 3481,
    firstClear: 588000,
    total: 591481,
  });
  expect(
    result.events.find((event) => event.description?.includes("🌟星主層")),
  ).toMatchObject({ kind: "effect", description: receipt.text.split("\n")[8] });
  expect(result.shield).toBeNull();
});

test.each([
  ["深淵汲取", "未知機制"],
  ["20% 破防追傷", "21% 破防追傷"],
  ["50% 的 HP", "500% 的 HP"],
  ["第 50 層：", "第 60 層："],
  ["孢子母體", "未知星主"],
  ["Lv250", "Lv251"],
  ["451,645", "451,64"],
  ["3,238", "9007199254740992"],
  ["')）", "')）未知費用"],
])("未知或異常星主預覽仍阻擋：%s", (from, to) => {
  const result = parse(receipt.text.replace(from, to));
  expect(result.complete).toBe(false);
  expect(result.outcome).toBe("unknown");
  expect(result.rewardGold.value).toBeNull();
  expect(nativeTowerReward(result)).toBeNull();
  expect(result.riskVerified).toBe(false);
});
