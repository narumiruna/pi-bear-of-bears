import type { CombatObservation } from "../../src/combat-planner.js";

/** 合成觀測，不是 Telegram 原文或實戰安全證據。 */
export function combatObservation(date = 1_800_000_000): CombatObservation {
  const source = (messageId: number) => ({
    messageId,
    revision: "a".repeat(64),
    date,
  });
  return {
    mode: "boss",
    character: { name: "測試熊", hp: 1200, maxHp: 2000, mp: 80, idle: false },
    target: { name: "合成訓練王", hp: 900, present: true },
    lastOutcome: "confirmed",
    rateLimited: false,
    evidence: {
      status: source(1),
      target: source(2),
      risk: source(3),
      actions: source(4),
    },
    risk: {
      mechanicsComplete: true,
      beforeActionUpperBound: 300,
      afterActionUpperBound: 400,
      explanation:
        "合成案例：先機最多 300，命中或未中後含狂暴與追加傷害最多 400；不依賴護盾或回血。",
    },
    actions: [
      {
        kind: "attack",
        available: true,
        costsComplete: true,
        mpCost: 0,
        hpCost: 0,
        expectedDamage: 200,
      },
      {
        kind: "skill",
        name: "合成小招",
        available: true,
        costsComplete: true,
        mpCost: 12,
        hpCost: 0,
        expectedDamage: 700,
      },
      {
        kind: "skill",
        name: "合成大招",
        available: true,
        costsComplete: true,
        mpCost: 32,
        hpCost: 0,
        expectedDamage: 1800,
      },
    ],
  };
}
