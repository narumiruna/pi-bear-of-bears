import type { CombatEvent } from "./combat-events.js";

interface EnemyEffectState {
  events: CombatEvent[];
  issues: string[];
  targets: Set<string>;
  royalStrike: boolean;
  counter: boolean;
  settled: boolean;
  number: (raw: string | undefined) => number | null;
}

/** 只保存已觀察敵方註記，不補倍率、TTL 或獨立承傷。 */
export function nativeEnemyEffect(
  state: EnemyEffectState,
  line: string,
  position: number,
) {
  const armor = /^⚒️ 裂甲！(.+) 防禦 −([\d,]+)（累計 −([\d,]+)）$/u.exec(line);
  if (armor) {
    const reduction = state.number(armor[2]),
      cumulative = state.number(armor[3]);
    state.targets.add(armor[1]);
    if (reduction !== null && cumulative !== null && cumulative < reduction) {
      state.issues.push("裂甲累計減值小於本次減值。");
    }
    // 只保存本手明示的減值及累計原文，不倒推敵 DEF、TTL 或跨手疊層。
    state.events.push({
      line: position,
      kind: "armor_reduction",
      nominal: {
        value: reduction,
        basis: reduction === null ? "unknown" : "observed",
      },
      description: line,
    });
    return true;
  }
  const royalStrike = /^👑 (.+) 王者重擊！$/u.exec(line);
  if (royalStrike) {
    if (
      state.royalStrike ||
      state.counter ||
      state.settled ||
      !state.events.some((event) => event.kind === "damage") ||
      state.events.some((event) => event.kind === "reflection")
    ) {
      state.issues.push("王者重擊註記重複或順序矛盾。");
    }
    state.royalStrike = true;
    state.targets.add(royalStrike[1]);
    // 此行是反擊註記，沒有獨立傷害數值；不補倍率或另加承傷。
    state.events.push({ line: position, kind: "effect", description: line });
    return true;
  }
  const charge = /^💥 (.+) 蠻力衝撞！傷害大增。$/u.exec(line);
  if (charge) {
    state.targets.add(charge[1]);
    // 文案沒有數值，不補倍率或未來承傷上界。
    state.events.push({ line: position, kind: "effect", description: line });
    return true;
  }
  return false;
}
