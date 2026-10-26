import type { CombatEvent, Fact } from "./combat-events.js";
import { numberValue } from "./workflow-parser-values.js";

/** 820047：只辨識正式擊殺後、完整且位於末尾的首達四行協定。 */
export function nativeTowerFooter(lines: string[], monsterGold: number | null) {
  const rows = lines.map((line) => line.trim());
  while (rows.at(-1) === "") {
    rows.pop();
  }
  if (rows.length !== 4 || monsterGold === null) {
    return null;
  }
  const cleared = /^🗼 第 ([1-9]\d*) 層攻破！$/u.exec(rows[0]);
  const first = /^⭐ 個人首達！獎勵 🪙([\d,]+)$/u.exec(rows[1]);
  const next =
    /^🗼 第 ([1-9]\d*) 層：(.+) Lv([1-9]\d*)（HP ([\d,]+)／ATK ([\d,]+)）$/u.exec(
      rows[2],
    );
  if (
    !cleared ||
    !first ||
    !next ||
    rows[3] !== "/attack 或 /skill 繼續攻塔｜/tower quit 結束挑戰"
  ) {
    return null;
  }
  const floor = numberValue(cleared[1]);
  const bonus = numberValue(first[1]);
  const [nextFloor, level, hp, attack] = [
    next[1],
    next[3],
    next[4],
    next[5],
  ].map(numberValue);
  if (
    floor === null ||
    bonus === null ||
    bonus <= 0 ||
    nextFloor === null ||
    nextFloor !== floor + 1 ||
    level === null ||
    level <= 0 ||
    hp === null ||
    hp <= 0 ||
    attack === null ||
    attack <= 0 ||
    !Number.isSafeInteger(monsterGold + bonus)
  ) {
    return null;
  }
  return { floor, bonus, next: rows[2] };
}

/** 共用已完整解析的事件，避免帳本與區間對帳各猜一次首達金額。 */
export function nativeTowerReward(combat: {
  format: string;
  complete: boolean;
  outcome: string;
  rewardGold: Fact;
  events: CombatEvent[];
}) {
  if (
    combat.format !== "native_skill" ||
    !combat.complete ||
    combat.outcome !== "won"
  ) {
    return null;
  }
  const floors = combat.events.filter((event) => event.kind === "tower_clear");
  const bonuses = combat.events.filter(
    (event) => event.kind === "tower_first_clear_gold",
  );
  if (floors.length !== 1 || bonuses.length !== 1) {
    return null;
  }
  const floor = floors[0].nominal?.value;
  const firstClear = bonuses[0].nominal?.value;
  const repeatable = combat.rewardGold.value;
  if (
    typeof floor !== "number" ||
    typeof firstClear !== "number" ||
    repeatable === null ||
    !Number.isSafeInteger(floor) ||
    floor <= 0 ||
    !Number.isSafeInteger(firstClear) ||
    firstClear <= 0 ||
    !Number.isSafeInteger(repeatable) ||
    repeatable < 0 ||
    !Number.isSafeInteger(firstClear + repeatable)
  ) {
    return null;
  }
  return {
    floor,
    firstClear,
    repeatable,
    total: firstClear + repeatable,
    format: "native" as const,
  };
}
