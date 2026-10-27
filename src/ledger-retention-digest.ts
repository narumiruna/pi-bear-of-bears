import { ledgerEvidence } from "./ledger-evidence.js";
import { type LedgerCombat, ledgerFact } from "./ledger-facts.js";
import { projectLedger } from "./ledger-projection.js";
import type { LedgerData } from "./ledger-types.js";

/** 將重複實戰樣本分組，保留條件、來源與觀測範圍；不是公式或理論上界。 */
export function retentionPatterns(data: LedgerData, observationIds: number[]) {
  const included = new Set(observationIds),
    projection = projectLedger(data);
  const observations = new Map(data.observations.map((o) => [o.id, o]));
  const owner = new Map(
    projection.operations.flatMap((o) =>
      o.source ? [[o.source.observationId, o.character ?? null] as const] : [],
    ),
  );
  const evidence = new Map(
    ledgerEvidence(data).samples.map((s) => [s.source.observationId, s]),
  );
  const groups = new Map<
    string,
    {
      character: string | null;
      target: string | null;
      skill: string | null;
      mpCost: number | null;
      shield: unknown;
      effects: string[];
      observedConditions: unknown;
      missingConditions: string[];
      parsingComplete: boolean;
      groupingDoesNotProveComparability: true;
      samples: number;
      observedCounter: { min: number; max: number } | null;
      firstSource: unknown;
      lastSource: unknown;
      sampleNotUpperBound: true;
    }
  >();
  for (const row of data.facts) {
    if (!included.has(row.observationId)) {
      continue;
    }
    const combat = ledgerFact<LedgerCombat>(row.facts, "combat");
    if (!combat) {
      continue;
    }
    const cost = ledgerFact<{ amount: number; skill: string | null }>(
      row.facts,
      "mp_cost",
    );
    const conditions = {
      character: owner.get(row.observationId) ?? null,
      target: combat.target,
      skill: cost?.skill ?? null,
      mpCost: cost?.amount ?? null,
      shield: combat.shield,
      observedConditions: evidence.get(row.observationId)?.conditions ?? null,
      missingConditions: evidence.get(row.observationId)?.missingConditions ?? [
        "未取得條件證據",
      ],
      parsingComplete: combat.complete,
      groupingDoesNotProveComparability: true as const,
      effects: [
        ...new Set(
          combat.events
            .filter((e) => ["effect", "initiative_marker"].includes(e.kind))
            .flatMap((e) => (e.description ? [e.description] : [])),
        ),
      ].sort(),
    };
    const key = JSON.stringify(conditions),
      source = observations.get(row.observationId);
    const position = source
      ? {
          observationId: source.id,
          messageId: source.message.id,
          revision: source.message.revision,
          date: source.message.date,
        }
      : null;
    const group = groups.get(key) ?? {
      ...conditions,
      samples: 0,
      observedCounter: null,
      firstSource: position,
      lastSource: position,
      sampleNotUpperBound: true as const,
    };
    group.samples++;
    group.lastSource = position;
    for (const event of combat.events) {
      if (event.kind === "counter" && typeof event.actual?.value === "number") {
        const value = event.actual.value;
        group.observedCounter = group.observedCounter
          ? {
              min: Math.min(group.observedCounter.min, value),
              max: Math.max(group.observedCounter.max, value),
            }
          : { min: value, max: value };
      }
    }
    groups.set(key, group);
  }
  const all = [...groups.values()];
  return {
    patterns:
      all.length <= 128 ? all : [...all.slice(0, 64), ...all.slice(-64)],
    omittedPatterns: Math.max(0, all.length - 128),
    note: "範圍僅為已觀測樣本；不能推最大傷害、固定機率或未來安全。所有機器事實仍在checkpoint中，省略群組不等於沒有其他機制。",
  };
}
