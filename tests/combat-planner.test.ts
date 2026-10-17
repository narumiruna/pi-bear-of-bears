import { Check } from "typebox/value";
import { expect, test } from "vitest";
import {
  COMBAT_PLAN_SCHEMA,
  type CombatObservation,
  planCombat,
} from "../src/combat-planner.js";
import { combatObservation } from "./fixtures/combat-observation.js";

const NOW = 1_800_000_000_000;
function defined<T>(value: T | undefined): T {
  if (value === undefined) {
    throw new Error("合成觀測缺少必要欄位。");
  }
  return value;
}
const plan = (input: unknown) => {
  const result = planCombat(input, NOW);
  expect(Check(COMBAT_PLAN_SCHEMA, result)).toBe(true);
  return result;
};

test("單步預算保留先機及未命中反擊，保留證據、不修改輸入", () => {
  const input = combatObservation();
  const copy = structuredClone(input);
  const result = plan(input);
  expect(result.state).toBe("ready");
  expect(result.recommendation).toEqual({
    tool: "bears_skill",
    arguments: { name: "合成大招" },
    actionIndex: 2,
    mpCost: 32,
    hpCost: 0,
    expectedDamage: 1800,
  });
  expect(result.budget).toEqual({
    beforeActionUpperBound: 300,
    afterActionUpperBound: 400,
    hpCost: 0,
    totalHpRequired: 701,
    remainingHp: 500,
  });
  expect(result.evidence).toEqual(input.evidence);
  expect(result.riskExplanation).toBe(input.risk?.explanation);
  expect(result.warnings.join(" ")).toContain("不是安全證明");
  expect(input).toEqual(copy);
  defined(result.evidence.status).messageId = 99;
  expect(input.evidence.status?.messageId).toBe(1);
});

test.each([
  [3000, 2],
  [900, 2],
  [700, 1],
  [201, 1],
  [200, 0],
  [1, 0],
])("殘血 %i 依預估傷害與 MP 排序，不硬套大招", (hp, actionIndex) => {
  const input = combatObservation();
  input.target.hp = hp;
  const result = plan(input);
  expect(result.recommendation?.actionIndex).toBe(actionIndex);
  if (actionIndex === 0) {
    expect(result.recommendation).toMatchObject({
      tool: "bears_attack",
      arguments: { target: input.target.name },
    });
  }
});

test.each([
  [700, "recover"],
  [701, "ready"],
])("HP %i：必須嚴格大於兩受與主動耗血合計", (hp, state) => {
  const input = combatObservation();
  input.character.hp = hp;
  input.target.hp = 1; // 即使預估普攻可終殺，也不得省略未命中反擊。
  const result = plan(input);
  expect(result.state).toBe(state);
  if (state === "recover") {
    expect(result.recommendation).toBeNull();
    expect(result.rejected).toHaveLength(3);
  } else {
    expect(result.budget?.remainingHp).toBe(1);
  }
});

test("主動耗血、MP 不足及不可用招式均不列入候選", () => {
  const input = combatObservation();
  input.actions[2].hpCost = 600;
  expect(plan(input).recommendation?.actionIndex).toBe(1);
  input.actions[2].hpCost = 0;
  input.character.mp = 12;
  expect(plan(input).recommendation?.actionIndex).toBe(1);
  input.character.mp = 11;
  expect(plan(input).recommendation?.actionIndex).toBe(0);
  input.actions[0].available = false;
  expect(plan(input).state).toBe("recover");
});

test("未知副作用的招式被排除；全部未知時要求補觀測", () => {
  const input = combatObservation();
  input.actions[2].costsComplete = false;
  expect(plan(input).recommendation?.actionIndex).toBe(1);
  for (const action of input.actions) {
    action.costsComplete = false;
  }
  expect(plan(input).state).toBe("needs_observation");
});

const missingData: [string, (input: CombatObservation) => void][] = [
  [
    "risk",
    (input) => {
      delete input.risk;
    },
  ],
  [
    "特殊機制",
    (input) => {
      defined(input.risk).mechanicsComplete = false;
    },
  ],
  [
    "先機上界",
    (input) => {
      delete input.risk?.beforeActionUpperBound;
    },
  ],
  [
    "最壞後續傷害上界",
    (input) => {
      delete input.risk?.afterActionUpperBound;
    },
  ],
  [
    "可用招式",
    (input) => {
      input.actions = [];
    },
  ],
  ...(["status", "target", "risk", "actions"] as const).map(
    (key) =>
      [
        `${key} 證據`,
        (input: CombatObservation) => {
          delete input.evidence[key];
        },
      ] as [string, (input: CombatObservation) => void],
  ),
];

test.each(missingData)("缺少 %s 不補零、不建議攻擊", (_name, mutate) => {
  const input = combatObservation();
  mutate(input);
  const result = plan(input);
  expect(result.state).toBe("needs_observation");
  expect(result.recommendation).toBeNull();
});

test.each(["status", "target", "risk", "actions"] as const)(
  "%s 來源：拒絕未來或超過 60 秒，接受恰好 60 秒",
  (key) => {
    const input = combatObservation();
    const source = defined(input.evidence[key]);
    source.date += 1;
    expect(plan(input).state).toBe("needs_observation");
    source.date -= 62;
    expect(plan(input).state).toBe("needs_observation");
    source.date += 1;
    expect(plan(input).state).toBe("ready");
  },
);

const stopCases: [string, (input: CombatObservation) => void][] = [
  [
    "rate limit",
    (input) => {
      input.rateLimited = true;
    },
  ],
  [
    "結果不明",
    (input) => {
      input.lastOutcome = "unknown";
    },
  ],
  [
    "HP 矛盾",
    (input) => {
      input.character.hp = 2001;
    },
  ],
  [
    "死亡",
    (input) => {
      input.character.hp = 0;
    },
  ],
  [
    "掛機中",
    (input) => {
      input.character.idle = true;
    },
  ],
  [
    "目標未現身",
    (input) => {
      input.target.present = false;
      input.target.hp = 0;
    },
  ],
];

test.each(stopCases)("%s 停止，不產生待送指令", (_name, mutate) => {
  const input = combatObservation();
  mutate(input);
  const result = plan(input);
  expect(result.state).toBe("stop");
  expect(result.recommendation).toBeNull();
});

test("目標 HP 為 0 只表示該目標倒下，不代替掉落與任務驗收", () => {
  const input = combatObservation();
  input.target.hp = 0;
  const result = plan(input);
  expect(result.state).toBe("target_defeated");
  expect(result.recommendation).toBeNull();
  expect(result.reasons.join(" ")).toContain("仍須另行確認");
});

test("tower 必須有樓層，boss 不接受塔樓層；不依怪名套用機制", () => {
  const input = combatObservation();
  input.mode = "tower";
  expect(plan(input).state).toBe("needs_observation");
  input.target.floor = 50;
  expect(plan(input).state).toBe("ready");
  defined(input.risk).mechanicsComplete = false;
  expect(plan(input).state).toBe("needs_observation");
  input.mode = "boss";
  expect(plan(input).state).toBe("needs_observation");
});

test("合成序列 replay：殘血換招、恢復後重驗機制，不沿用前層或舊盾", () => {
  const snapshots = Array.from({ length: 5 }, () => combatObservation());
  snapshots[1].target.hp = 650;
  snapshots[2].character.hp = 700;
  snapshots[2].target.hp = 1;
  snapshots[3].character.hp = 2000;
  snapshots[3].mode = "tower";
  snapshots[3].target.floor = 29;
  delete snapshots[3].risk;
  snapshots[4].mode = "tower";
  snapshots[4].target.floor = 30;
  defined(snapshots[4].risk).beforeActionUpperBound = 600;
  defined(snapshots[4].risk).afterActionUpperBound = 600;
  expect(
    snapshots.map((snapshot) => {
      const result = plan(snapshot);
      return [result.state, result.recommendation?.actionIndex ?? null];
    }),
  ).toEqual([
    ["ready", 2],
    ["ready", 1],
    ["recover", null],
    ["needs_observation", null],
    ["recover", null],
  ]);
});

test("排序平手保留原順序，明列零傷與非零普攻成本的拒絕原因", () => {
  const input = combatObservation();
  input.actions = [
    structuredClone(input.actions[1]),
    structuredClone(input.actions[1]),
  ];
  expect(plan(input).recommendation?.actionIndex).toBe(0);
  input.actions = combatObservation().actions;
  input.actions[0].mpCost = 1;
  input.actions[1].expectedDamage = 0;
  const result = plan(input);
  expect(result.rejected.map((entry) => entry.actionIndex)).toEqual([0, 1]);
  expect(result.recommendation?.actionIndex).toBe(2);
});

test.each([NaN, Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
  "拒絕非法 HP %s",
  (hp) => {
    const input = combatObservation();
    input.character.hp = hp;
    expect(() => plan(input)).toThrow("schema");
  },
);

test.each(["/attack", "技能\n/attack", "技能\u0000", " 技能", "技能 "])(
  "拒絕名稱中的指令、控制字元與頭尾空白 %s",
  (name) => {
    const input = combatObservation();
    input.actions[1] = { ...input.actions[1], kind: "skill", name };
    expect(() => plan(input)).toThrow();
  },
);

test("不接受未知欄位、缺少成本與溢出的預算", () => {
  expect(() => plan({ ...combatObservation(), autoExecute: true })).toThrow(
    "schema",
  );
  const input = combatObservation();
  const malformed = structuredClone(input) as unknown as {
    actions: Record<string, unknown>[];
  };
  delete malformed.actions[0].hpCost;
  expect(() => plan(malformed)).toThrow("schema");
  defined(input.risk).beforeActionUpperBound = Number.MAX_SAFE_INTEGER;
  defined(input.risk).afterActionUpperBound = Number.MAX_SAFE_INTEGER;
  const result = plan(input);
  expect(result.state).toBe("recover");
  expect(
    result.rejected.every((entry) => entry.reason.includes("安全整數")),
  ).toBe(true);
});
