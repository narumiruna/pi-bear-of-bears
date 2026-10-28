import type { CombatEvent } from "./combat-events.js";

interface MagicState {
  events: CombatEvent[];
  targets: Set<string>;
  number: (raw: string | undefined) => number | null;
  hpEvent: (kind: string, raw: string[], line: number, enemy?: boolean) => void;
}

/** 已觀測法術註記；只保留當手文字，不推易傷倍率、狀態 TTL 或未來降攻。 */
export function nativeMagicEffect(
  state: MagicState,
  line: string,
  position: number,
) {
  const tick =
    /^🟣 毒孢侵蝕！[^\p{L}\p{N}]* 受到 ([\d,]+) 點持續傷害。HP：([\d,]+)\/([\d,]+)$/u.exec(
      line,
    );
  if (tick) {
    // 與直接傷害共用 HP 轉移檢查；首次敵 HP 未知時實傷仍未知。
    state.hpEvent("dot", tick.slice(1), position, true);
    return true;
  }
  const execution = /^☠️ 斬殺！(.+) 命懸一線，傷害爆增！$/u.exec(line);
  const softened =
    /^（斬殺超過 ([1-9][\d,]*) 的部分折半計算，無硬上限）$/u.exec(line);
  if (execution || softened) {
    if (execution) {
      state.targets.add(execution[1]);
    }
    if (softened) {
      state.number(softened[1]);
    }
    // 845024：只存本次註記；不當硬上限、倍率、終殺保證或未來生存預算。
    state.events.push({ line: position, kind: "effect", description: line });
    return true;
  }
  const bonus = /^（🔥越戰越勇\+([\d,]+)%(?:／🎯易傷\+([\d,]+)%)?）$/u.exec(
    line,
  );
  const vulnerability =
    /^🎯 (.+) 被撕開破綻！接下來數回合受到的傷害 \+([\d,]+)%$/u.exec(line);
  const reduction =
    /^👊 (.+) 攻擊力降低 ([\d,]+) 點！（現 ATK ([\d,]+)）$/u.exec(line);
  const attached =
    /^🟣 毒孢附著！接下來 ([\d,]+) 回合每回合造成 ([\d,]+) 傷害。$/u.exec(line);
  if (!bonus && !vulnerability && !reduction && !attached) {
    return false;
  }
  const match = bonus ?? vulnerability ?? reduction ?? attached;
  if (!match) {
    return false;
  }
  const values = vulnerability || reduction ? match.slice(2) : match.slice(1);
  for (const value of values) {
    if (value !== undefined) {
      state.number(value);
    }
  }
  if (vulnerability || reduction) {
    state.targets.add(match[1]);
  }
  // 降攻標稱值不當作實際差值；多個數值完整保留於原文，不猜套用順序。
  state.events.push({ line: position, kind: "effect", description: line });
  return true;
}
