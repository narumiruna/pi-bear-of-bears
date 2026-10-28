import type { CombatEvent, Fact } from "./combat-events.js";
import { numberValue } from "./workflow-parser-values.js";

/** 正式首達尾段；只接受已核獎勵及下層預覽，預覽不推實戰效果。 */
export function nativeTowerFooter(lines: string[], monsterGold: number | null) {
  const rows = lines.map((line) => line.trim());
  while (rows.at(-1) === "") {
    rows.pop();
  }
  if ((rows.length !== 4 && rows.length !== 5) || monsterGold === null) {
    return null;
  }
  const cleared = /^🗼 第 ([1-9]\d*) 層攻破！$/u.exec(rows[0]);
  const first = /^⭐ 個人首達！獎勵 🪙([\d,]+)$/u.exec(rows[1]);
  const essence =
    rows.length === 5 ? /^💠 王之精魄 ×([1-9]\d*)$/u.exec(rows[2]) : null;
  const quantity = essence ? numberValue(essence[1]) : null;
  if (rows.length === 5 && (!essence || quantity === null)) {
    return null;
  }
  const nextIndex = rows.length - 2;
  const preview = rows[nextIndex];
  // 844011：限定已觀測的50層孢子星主tuple；仍由下方驗數值與相鄰樓層。
  // 只移除比對用註記，回傳保留完整原文，不套用成當前汲取／追傷效果。
  const knownStarPreview =
    /^🗼 第 50 層：🍄 🌟星主·孢子母體 Lv250（HP [\d,]+／ATK [\d,]+）　🌟星主層（\('深淵汲取', '攻擊回復所造成傷害 50% 的 HP，20% 破防追傷'\)）$/u.test(
      preview,
    );
  const nextLine = knownStarPreview
    ? preview.slice(0, preview.indexOf("　🌟星主層"))
    : preview;
  const next =
    /^🗼 第 ([1-9]\d*) 層：(.+) Lv([1-9]\d*)（HP ([\d,]+)／ATK ([\d,]+)）(?:　🩸重傷層：吸血\/回春 −60%)?$/u.exec(
      nextLine,
    );
  if (
    !cleared ||
    !first ||
    !next ||
    rows.at(-1) !== "/attack 或 /skill 繼續攻塔｜/tower quit 結束挑戰"
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
  return {
    floor,
    bonus,
    next: rows[nextIndex],
    nextIndex,
    essence: quantity === null ? null : { quantity, description: rows[2] },
  };
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
