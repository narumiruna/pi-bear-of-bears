import { ledgerBindings } from "./ledger-attribution.js";
import { ledgerEvidence } from "./ledger-evidence.js";
import { type LedgerCombat, ledgerFact } from "./ledger-facts.js";
import { projectLedger } from "./ledger-projection.js";
import {
  ledgerDamageComponents,
  ledgerGoldReport,
  ledgerRecoveryCycles,
} from "./ledger-report-accounting.js";
import type { LedgerData } from "./ledger-types.js";

/** 區間聯集；父子或重疊工具不重複加總，倒退時鐘不補零掩蓋。 */
export function ledgerActivity(
  intervals: readonly { start: number; end: number }[],
) {
  if (
    intervals.some(
      (i) =>
        !Number.isFinite(i.start) ||
        !Number.isFinite(i.end) ||
        i.start < 0 ||
        i.end < i.start,
    )
  ) {
    return {
      elapsedMs: null,
      activeMs: null,
      interruptions: [] as { start: number; end: number }[],
      clockValid: false,
    };
  }
  const ordered = [...intervals].sort((a, b) => a.start - b.start);
  if (ordered.length === 0) {
    return {
      elapsedMs: null,
      activeMs: null,
      interruptions: [],
      clockValid: true,
    };
  }
  let start = ordered[0].start,
    end = ordered[0].end,
    active = 0;
  const interruptions: { start: number; end: number }[] = [];
  for (const interval of ordered.slice(1)) {
    if (interval.start > end) {
      active += end - start;
      interruptions.push({ start: end, end: interval.start });
      start = interval.start;
    }
    end = Math.max(end, interval.end);
  }
  active += end - start;
  return {
    elapsedMs: end - ordered[0].start,
    activeMs: active,
    interruptions,
    clockValid: true,
  };
}
const sum = (values: number[]) => {
  let total = 0;
  for (const value of values) {
    if (!Number.isSafeInteger(value) || !Number.isSafeInteger(total + value)) {
      return null;
    }
    total += value;
  }
  return total;
};
export function ledgerReport(
  data: LedgerData,
  scope: {
    character?: string;
    fromMessageId?: number;
    throughMessageId?: number;
    afterObservationId?: number;
  } = {},
) {
  const projection = projectLedger(data, scope.character),
    selected = ledgerBindings(data);
  const from = scope.fromMessageId ?? 0,
    through = scope.throughMessageId ?? Number.MAX_SAFE_INTEGER;
  if (through < from) {
    throw new Error("區間終點不得早於起點。");
  }
  const operations = projection.operations.filter(
    (o) =>
      projection.character !== null &&
      o.character === projection.character &&
      o.source &&
      o.source.messageId >= from &&
      o.source.messageId <= through,
  );
  const ids = new Set(operations.map((o) => o.id));
  const observations = new Set(
    selected.bindings
      .filter((b) => ids.has(b.operation.id))
      .flatMap((b) =>
        [b.reply?.id, b.supplement?.id].filter(
          (n): n is number => n !== undefined,
        ),
      ),
  );
  const combats = selected.observations
    .filter((o) => observations.has(o.id))
    .flatMap((o) => {
      const combat = ledgerFact<LedgerCombat>(
        selected.facts.get(o.id) ?? [],
        "combat",
      );
      return combat ? [{ observationId: o.id, combat }] : [];
    });
  const damageKinds = [
    "damage",
    "critical_followup",
    "additional_damage",
    "reflection",
  ];
  const damage = combats.flatMap((c) =>
    c.combat.events.filter((e) => damageKinds.includes(e.kind)),
  );
  const knownDamage = damage.flatMap((e) =>
    typeof e.actual?.value === "number" ? [e.actual.value] : [],
  );
  const costs = operations.flatMap((o) =>
    typeof o.confirmedMpCost === "number" ? [o.confirmedMpCost] : [],
  );
  const mpSpent = projection.character !== null ? sum(costs) : null,
    effective =
      damage.length > 0 &&
      knownDamage.length === damage.length &&
      combats.every((c) => c.combat.complete)
        ? sum(knownDamage)
        : null;
  const metrics = data.events.filter((e) => e.kind === "metric");
  const linked = metrics.filter(
    (e) =>
      Array.isArray(e.data.operationIds) &&
      e.data.operationIds.some((id) => typeof id === "string" && ids.has(id)),
  );
  const intervals = (rows: typeof metrics) =>
    rows.flatMap((e) =>
      typeof e.data.startedAt === "number" &&
      typeof e.data.durationMs === "number"
        ? [
            {
              start: e.data.startedAt,
              end: e.data.startedAt + e.data.durationMs,
            },
          ]
        : [],
    );
  const timing = ledgerActivity(intervals(linked));
  const categories = Object.fromEntries(
    ["battle", "recovery", "query"].map((kind) => {
      const matching = linked.filter((e) =>
        operations.some(
          (o) =>
            Array.isArray(e.data.operationIds) &&
            e.data.operationIds.includes(o.id) &&
            (kind === "battle"
              ? /^\/(?:skill|attack)(?:\s|$)/u.test(o.command ?? "")
              : kind === "recovery"
                ? /^\/(?:rest|flee)$/u.test(o.command ?? "")
                : !/^\/(?:skill|attack|rest|flee)(?:\s|$)/u.test(
                    o.command ?? "",
                  )),
        ),
      );
      return [kind, ledgerActivity(intervals(matching)).activeMs];
    }),
  );
  const usages = data.events.filter((e) => e.kind === "usage");
  const modelUsage =
    usages.length > 0
      ? {
          input: sum(usages.map((e) => Number(e.data.input))),
          output: sum(usages.map((e) => Number(e.data.output))),
          totalTokens: sum(usages.map((e) => Number(e.data.totalTokens))),
          costUsd: usages.reduce(
            (n, e) => n + Number((e.data.cost as { total: number }).total),
            0,
          ),
          scope: "branch_not_operation",
        }
      : null;
  const recovery = ledgerRecoveryCycles(data, projection, { from, through });
  const evidence = ledgerEvidence(
    data,
    projection.character ?? undefined,
    scope.afterObservationId,
  ).samples.filter(
    (s) => s.source.messageId >= from && s.source.messageId <= through,
  );
  return {
    character: projection.character,
    compactions: data.compactions ?? [],
    compactedTimingAndUsageIncomplete: (data.compactions?.length ?? 0) > 0,
    interval: { fromMessageId: from, throughMessageId: through },
    samples: combats.length,
    confirmedMpCost: mpSpent,
    effectiveDamage: effective,
    knownPartialDamage: sum(knownDamage),
    damagePerAction:
      effective !== null && combats.length > 0
        ? effective / combats.length
        : null,
    damagePerMp:
      effective !== null && mpSpent !== null && mpSpent > 0
        ? effective / mpSpent
        : null,
    damageComponents: ledgerDamageComponents(combats.map((c) => c.combat)),
    recoveryCycles: operations.filter(
      (o) => o.command === "/rest" && o.state === "confirmed",
    ).length,
    damagePerRecoveryCycle: recovery.damagePerCompleteCycle,
    recoveryCycleSamples: recovery,
    timing: {
      ...timing,
      categories,
      source: "linked_tool_intervals",
      unobservedTimeIsNotProvenWaiting: true,
    },
    agent: {
      timing: ledgerActivity(intervals(metrics)),
      documentActiveMs: ledgerActivity(
        intervals(
          metrics.filter((e) =>
            ["write", "edit"].includes(String(e.data.toolName)),
          ),
        ),
      ).activeMs,
      modelUsage,
      scope: "branch_not_character_or_interval",
    },
    gold: ledgerGoldReport(projection, selected, from, through),
    coverage: {
      operations: operations.length,
      attributedCombats: combats.length,
      knownCosts: costs.length,
      knownDamageEvents: knownDamage.length,
      damageEvents: damage.length,
      metricLinkedOperations: new Set(
        linked.flatMap((e) => e.data.operationIds as string[]),
      ).size,
      modelUsageKnown: modelUsage !== null,
    },
    evidence,
    pending: projection.pending,
    gaps: projection.gaps,
    externalEvents: projection.externalEvents,
    operationalEligibility: false,
    riskVerified: false,
    limitations: [
      "未解析／缺頁不補零，已知部分傷害不是全段輸出。",
      ...((data.compactions?.length ?? 0) > 0
        ? [
            "部分舊事件已壓縮，逐筆原文不可還原；metric與usage明細可能省略，現列耗時與模型成本不能當完整歷史合計。",
          ]
        : []),
      "沒有穩定 server encounter ID；區間不等於已證明同一挑戰，通層回執不證明 Goal 完成。",
      "模型 usage 與文件耗時只按分支記錄，不能精確分攤到單手；既有無 operation ID 的 metrics 保持 unknown。",
      "首達與怪金分開，掉落不估價；時間中斷不是已知等待原因，離線量測不證明實機改善。",
    ],
  };
}
