import { expect, test } from "vitest";
import {
  type EquipmentCandidate,
  equipmentScore,
  optimizeEquipment,
} from "../src/equipment-optimizer.js";

function item(
  id: number,
  attack: number,
  equipped = false,
): EquipmentCandidate {
  return {
    id,
    name: `裝備${id}`,
    slot: "武器",
    stats: { attack, defense: 0, intelligence: 0, agility: 0 },
    equipped,
    eligible: true,
    effects: [],
  };
}
const options = { slots: ["武器"] };

test("預設等權重、嚴格提升、遊戲編號與平手保留", () => {
  const current = item(91, 5, true);
  expect(
    optimizeEquipment([current, item(42, 6)], options).recommendations,
  ).toEqual([
    {
      slot: "武器",
      currentId: 91,
      targetId: 42,
      currentScore: 5,
      targetScore: 6,
      delta: 1,
    },
  ]);
  expect(
    optimizeEquipment([item(42, 5), current], options).recommendations,
  ).toEqual([]);
  expect(
    optimizeEquipment([item(91, -5, true)], options).recommendations,
  ).toEqual([]);
});

test("缺漏、重複目前裝備與同名同屬性均阻擋", () => {
  for (const patch of [
    { slot: null },
    { stats: null },
    { eligible: null },
    { effects: null },
    { name: "" },
    { equipped: true },
  ]) {
    const result = optimizeEquipment(
      [item(1, 1, true), { ...item(2, 2), ...patch }],
      options,
    );
    expect(result.blockers.length).toBeGreaterThan(0);
    expect(result.recommendations).toEqual([]);
  }
  const duplicate = { ...item(3, 2), name: "裝備2" };
  expect(
    optimizeEquipment([item(1, 1, true), item(2, 2), duplicate], options)
      .recommendations,
  ).toEqual([]);
});

test("技能差異必須授權；未知效果不可透過授權補成已知", () => {
  const items = [item(1, 1, true), { ...item(2, 2), effects: ["技能甲"] }];
  expect(optimizeEquipment(items, options).recommendations).toEqual([]);
  expect(
    optimizeEquipment(items, { ...options, ignoreEffects: true })
      .recommendations,
  ).toHaveLength(1);
  expect(
    optimizeEquipment([{ ...item(1, 1, true), effects: null }, item(2, 2)], {
      ...options,
      ignoreEffects: true,
    }).recommendations,
  ).toEqual([]);
});

test("拒絕部分權重、非法數值、重複編號與溢位", () => {
  for (const attack of [NaN, Infinity, -Infinity]) {
    expect(() => optimizeEquipment([item(1, attack)], options)).toThrow();
  }
  expect(() =>
    optimizeEquipment([], { ...options, weights: { attack: 1 } as never }),
  ).toThrow();
  expect(() => optimizeEquipment([item(1, 1), item(1, 2)], options)).toThrow();
  expect(() =>
    equipmentScore(
      { attack: 1e308, defense: 1e308, intelligence: 0, agility: 0 },
      { attack: 2, defense: 1, intelligence: 1, agility: 1 },
    ),
  ).toThrow();
});

test("固定 seed 的 1000 組三部位案例與獨立窮舉一致", () => {
  let seed = 0x9e3779b9;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  const number = () => Math.floor(random() * 21 - 10) / 10;
  const slots = ["武器", "身體", "頭部"];
  for (let run = 0; run < 1000; run++) {
    const weights = {
      attack: number(),
      defense: number(),
      intelligence: number(),
      agility: number(),
    };
    const items = slots.flatMap((slot, s) =>
      Array.from({ length: 3 }, (_, n) => ({
        ...item(s * 3 + n + 1, 0, n === 0),
        slot,
        stats: {
          attack: number(),
          defense: number(),
          intelligence: number(),
          agility: number(),
        },
      })),
    );
    let best = -Infinity;
    for (let a = 0; a < 3; a++)
      for (let b = 3; b < 6; b++)
        for (let c = 6; c < 9; c++) {
          const total = [a, b, c].reduce((sum, index) => {
            const v = items[index].stats;
            return (
              sum +
              v.attack * weights.attack +
              v.defense * weights.defense +
              v.intelligence * weights.intelligence +
              v.agility * weights.agility
            );
          }, 0);
          best = Math.max(best, total);
        }
    const result = optimizeEquipment(items, { slots, weights });
    expect(result.blockers).toEqual([]);
    // 絕對容差 1e-10，僅用於對照浮點累加順序，不用於放寬換裝門檻。
    expect(Math.abs(result.predictedScore - best)).toBeLessThanOrEqual(1e-10);
  }
});
