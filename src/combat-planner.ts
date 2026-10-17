import { type Static, Type } from "typebox";
import { Check } from "typebox/value";

const integer = (minimum = 0) =>
  Type.Integer({ minimum, maximum: Number.MAX_SAFE_INTEGER });
const name = () =>
  Type.String({
    minLength: 1,
    maxLength: 200,
    pattern:
      "^[^/\\s\\u0000-\\u001f\\u007f][^\\u0000-\\u001f\\u007f\\u2028\\u2029]*$",
  });
const source = Type.Object(
  {
    messageId: integer(1),
    revision: Type.String({ pattern: "^[a-f0-9]{64}$" }),
    date: integer(1),
  },
  { additionalProperties: false },
);
const evidence = Type.Object(
  {
    status: Type.Optional(source),
    target: Type.Optional(source),
    risk: Type.Optional(source),
    actions: Type.Optional(source),
  },
  { additionalProperties: false },
);
const actionCosts = {
  mpCost: integer(),
  hpCost: integer(),
  costsComplete: Type.Boolean(),
  available: Type.Boolean(),
  expectedDamage: Type.Number({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
};

export const COMBAT_OBSERVATION_SCHEMA = Type.Object(
  {
    mode: Type.Union([Type.Literal("boss"), Type.Literal("tower")]),
    character: Type.Object(
      {
        name: name(),
        hp: integer(),
        maxHp: integer(1),
        mp: integer(),
        idle: Type.Boolean(),
      },
      { additionalProperties: false },
    ),
    target: Type.Object(
      {
        name: name(),
        present: Type.Boolean(),
        hp: integer(),
        floor: Type.Optional(integer(1)),
      },
      { additionalProperties: false },
    ),
    lastOutcome: Type.Union([
      Type.Literal("confirmed"),
      Type.Literal("unknown"),
    ]),
    rateLimited: Type.Boolean(),
    evidence,
    risk: Type.Optional(
      Type.Object(
        {
          mechanicsComplete: Type.Boolean(),
          beforeActionUpperBound: Type.Optional(integer()),
          afterActionUpperBound: Type.Optional(integer()),
          explanation: Type.String({ minLength: 1, maxLength: 1000 }),
        },
        { additionalProperties: false },
      ),
    ),
    actions: Type.Array(
      Type.Union([
        Type.Object(
          { kind: Type.Literal("attack"), ...actionCosts },
          { additionalProperties: false },
        ),
        Type.Object(
          { kind: Type.Literal("skill"), name: name(), ...actionCosts },
          { additionalProperties: false },
        ),
      ]),
      { maxItems: 30 },
    ),
  },
  { additionalProperties: false },
);

const recommendation = Type.Union([
  Type.Object(
    {
      tool: Type.Literal("bears_attack"),
      arguments: Type.Object(
        { target: name() },
        { additionalProperties: false },
      ),
      actionIndex: integer(),
      expectedDamage: Type.Number(),
      mpCost: integer(),
      hpCost: integer(),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      tool: Type.Literal("bears_skill"),
      arguments: Type.Object({ name: name() }, { additionalProperties: false }),
      actionIndex: integer(),
      expectedDamage: Type.Number(),
      mpCost: integer(),
      hpCost: integer(),
    },
    { additionalProperties: false },
  ),
]);

export const COMBAT_PLAN_SCHEMA = Type.Object(
  {
    version: Type.Literal(1),
    readOnly: Type.Literal(true),
    basis: Type.Literal("supplied-observation"),
    state: Type.Union([
      Type.Literal("needs_observation"),
      Type.Literal("ready"),
      Type.Literal("recover"),
      Type.Literal("stop"),
      Type.Literal("target_defeated"),
    ]),
    context: Type.Object({
      mode: Type.Union([Type.Literal("boss"), Type.Literal("tower")]),
      character: name(),
      target: name(),
      floor: Type.Union([integer(1), Type.Null()]),
    }),
    evidence,
    riskExplanation: Type.Union([Type.String(), Type.Null()]),
    reasons: Type.Array(Type.String()),
    warnings: Type.Array(Type.String()),
    recommendation: Type.Union([recommendation, Type.Null()]),
    budget: Type.Union([
      Type.Object({
        beforeActionUpperBound: integer(),
        afterActionUpperBound: integer(),
        hpCost: integer(),
        totalHpRequired: integer(1),
        remainingHp: integer(1),
      }),
      Type.Null(),
    ]),
    rejected: Type.Array(
      Type.Object({ actionIndex: integer(), reason: Type.String() }),
    ),
  },
  { additionalProperties: false },
);

export type CombatObservation = Static<typeof COMBAT_OBSERVATION_SCHEMA>;
export type CombatPlan = Static<typeof COMBAT_PLAN_SCHEMA>;
const MAX_AGE_SECONDS = 60;

/** 純計算：來源及承傷上界由呼叫者提供，不驗證 Telegram 原文或操作授權。 */
export function planCombat(input: unknown, now = Date.now()): CombatPlan {
  if (!Check(COMBAT_OBSERVATION_SCHEMA, input) || !Number.isFinite(now)) {
    throw new Error(
      "戰鬥觀測不符合 schema；不接受缺少成本、未知欄位或非有限數值。",
    );
  }
  const observation = input as CombatObservation;
  const names = [observation.character.name, observation.target.name];
  for (const action of observation.actions) {
    if (action.kind === "skill") {
      names.push(action.name);
    }
  }
  if (names.some((value) => value !== value.trim())) {
    throw new Error("角色、目標及技能名稱不接受頭尾空白。");
  }
  const { character, target, risk } = observation;
  const result: CombatPlan = {
    version: 1,
    readOnly: true,
    basis: "supplied-observation",
    state: "needs_observation",
    context: {
      mode: observation.mode,
      character: character.name,
      target: target.name,
      floor: target.floor ?? null,
    },
    evidence: structuredClone(observation.evidence),
    riskExplanation: risk?.explanation ?? null,
    reasons: [],
    warnings: [
      "僅依呼叫者提供的觀測與上界計算，未查驗原文、身分綁定或授權；ready 不是安全證明或執行許可。",
      "expectedDamage 僅用於排序，不保證命中或終殺；不預支吸血、閃避、暴擊、DOT 或未來降攻。",
      "每次操作後須重新取得觀測；不沿用舊護盾、易傷或樓層機制。",
    ],
    recommendation: null,
    budget: null,
    rejected: [],
  };
  const finish = (state: CombatPlan["state"], ...reasons: string[]) => {
    result.state = state;
    result.reasons.push(...reasons);
    return result;
  };
  if (observation.rateLimited) {
    return finish("stop", "Telegram rate limit：停止操作，不輪詢或自動重試。");
  }
  if (observation.lastOutcome === "unknown") {
    return finish(
      "stop",
      "上一筆結果不明：先讀 bears_history，絕不可重送操作。",
    );
  }
  if (character.hp > character.maxHp) {
    return finish("stop", "HP 大於 maxHp，觀測矛盾。");
  }
  if (character.hp === 0) {
    return finish("stop", "角色 HP 為 0，不建議戰鬥或自動恢復。");
  }
  if (character.idle) {
    return finish("stop", "角色仍在掛機；須先依授權結算並重新取得觀測。");
  }
  if (
    (observation.mode === "tower" && target.floor === undefined) ||
    (observation.mode === "boss" && target.floor !== undefined)
  ) {
    return finish(
      "needs_observation",
      "mode 與樓層資料不一致，須核對目前遭遇。",
    );
  }
  for (const key of ["status", "target", "risk", "actions"] as const) {
    const entry = observation.evidence[key];
    if (!entry) {
      result.reasons.push(`缺少 ${key} 的訊息 ID、revision 與時間。`);
    } else {
      const age = now / 1000 - entry.date;
      if (age < 0 || age > MAX_AGE_SECONDS) {
        result.reasons.push(
          `${key} 來源不在最近 ${MAX_AGE_SECONDS} 秒內，須重新核對。`,
        );
      }
    }
  }
  if (result.reasons.length > 0) {
    return result;
  }
  if (!target.present) {
    return finish("stop", "目標未現身；不等待重生，也不推定已擊敗。");
  }
  if (target.hp === 0) {
    return finish(
      "target_defeated",
      "提供的目標 HP 為 0；掉落、收益與下一層仍須另行確認。",
    );
  }
  if (
    !risk?.mechanicsComplete ||
    risk.beforeActionUpperBound === undefined ||
    risk.afterActionUpperBound === undefined
  ) {
    return finish(
      "needs_observation",
      "缺少完整機制或承傷上界；不得只用 ATK、consider 勝率或歷史小傷補值。",
    );
  }
  if (observation.actions.length === 0) {
    return finish("needs_observation", "缺少目前可用的攻擊招式與成本。");
  }
  const before = risk.beforeActionUpperBound;
  const after = risk.afterActionUpperBound;
  const candidates: Array<{
    action: CombatObservation["actions"][number];
    actionIndex: number;
    requiredHp: number;
  }> = [];
  for (const [actionIndex, action] of observation.actions.entries()) {
    const requiredHp = before + after + action.hpCost + 1;
    let reason: string | undefined;
    if (!action.costsComplete) {
      reason = "完整成本或副作用未知。";
    } else if (!action.available) {
      reason = "招式目前不可用。";
    } else if (
      action.kind === "attack" &&
      (action.mpCost !== 0 || action.hpCost !== 0)
    ) {
      reason = "普攻列出非零主動成本，協定不符。";
    } else if (action.expectedDamage <= 0) {
      reason = "沒有正的傷害預估；此原型不規劃自療或防護技能。";
    } else if (!Number.isSafeInteger(requiredHp)) {
      reason = "承傷預算超過安全整數範圍。";
    } else if (action.mpCost > character.mp) {
      reason = `MP 不足：需要 ${action.mpCost}，目前 ${character.mp}。`;
    } else if (requiredHp > character.hp) {
      reason = `HP 不足：包含先機、最壞後續傷害與主動耗血至少需要 ${requiredHp}，目前 ${character.hp}。`;
    }
    if (reason) {
      result.rejected.push({ actionIndex, reason });
    } else {
      candidates.push({ action, actionIndex, requiredHp });
    }
  }
  if (candidates.length === 0) {
    if (observation.actions.some((action) => !action.costsComplete)) {
      return finish(
        "needs_observation",
        "沒有可選攻擊，且仍有招式的完整成本或副作用未知。",
      );
    }
    return finish(
      "recover",
      "沒有符合所提供資源與承傷預算的攻擊；先核對恢復或撤退路線，不自動施法、逃跑或退出星塔。",
    );
  }
  const predictedFinish = candidates.filter(
    ({ action }) => action.expectedDamage >= target.hp,
  );
  const pool = predictedFinish.length > 0 ? predictedFinish : candidates;
  pool.sort((left, right) => {
    if (predictedFinish.length > 0) {
      return (
        left.action.mpCost - right.action.mpCost ||
        left.action.hpCost - right.action.hpCost ||
        right.action.expectedDamage - left.action.expectedDamage ||
        left.actionIndex - right.actionIndex
      );
    }
    return (
      right.action.expectedDamage - left.action.expectedDamage ||
      left.action.mpCost - right.action.mpCost ||
      left.action.hpCost - right.action.hpCost ||
      left.actionIndex - right.actionIndex
    );
  });
  const { action, actionIndex, requiredHp } = pool[0];
  const costs = {
    actionIndex,
    expectedDamage: action.expectedDamage,
    mpCost: action.mpCost,
    hpCost: action.hpCost,
  };
  result.recommendation =
    action.kind === "attack"
      ? { tool: "bears_attack", arguments: { target: target.name }, ...costs }
      : { tool: "bears_skill", arguments: { name: action.name }, ...costs };
  result.budget = {
    beforeActionUpperBound: before,
    afterActionUpperBound: after,
    hpCost: action.hpCost,
    totalHpRequired: requiredHp,
    remainingHp: character.hp - requiredHp + 1,
  };
  return finish(
    "ready",
    predictedFinish.length > 0
      ? "在符合所提供預算的候選中，選擇預估可終殺且 MP 成本最低者；仍保留未命中的完整承傷。"
      : "在符合所提供預算的候選中，選擇預估傷害最高者；這是單步啟發式，不是整場最佳策略。",
  );
}
