import type { ledgerBindings } from "./ledger-attribution.js";
import {
  type LedgerCombat,
  type LedgerStatus,
  ledgerFact,
} from "./ledger-facts.js";
import type { projectLedger } from "./ledger-projection.js";
import type { LedgerData } from "./ledger-types.js";

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
export function ledgerGoldReport(
  projection: ReturnType<typeof projectLedger>,
  selected: ReturnType<typeof ledgerBindings>,
  from: number,
  through: number,
) {
  const all = projection.account?.transactions ?? [],
    transactions = all.filter(
      (t) => t.source.messageId >= from && t.source.messageId <= through,
    );
  const statuses = selected.observations.flatMap((obs) => {
    const status = ledgerFact<LedgerStatus>(
      selected.facts.get(obs.id) ?? [],
      "status",
    );
    return status?.name === projection.character && status.gold !== null
      ? [{ id: obs.message.id, gold: status.gold }]
      : [];
  });
  const before =
    statuses.filter((s) => s.id <= from).at(-1) ??
    statuses.find((s) => s.id >= from && s.id <= through);
  const after = statuses.filter((s) => s.id <= through).at(-1);
  const actualDelta =
    before &&
    after &&
    after.id > before.id &&
    Number.isSafeInteger(after.gold - before.gold)
      ? after.gold - before.gold
      : null;
  const expectedDelta =
    before && after && after.id > before.id
      ? sum(
          all
            .filter(
              (t) =>
                t.source.messageId > before.id &&
                t.source.messageId <= after.id,
            )
            .map((t) => t.credit - t.debit),
        )
      : null;
  return {
    coverage: "confirmed_receipts_only",
    firstClear: sum(transactions.map((t) => t.firstClear)),
    repeatable: sum(transactions.map((t) => t.repeatable)),
    credits: sum(transactions.map((t) => t.credit)),
    debits: sum(transactions.map((t) => t.debit)),
    totalClearReceipts: sum(
      transactions.filter((t) => t.category === "tower").map((t) => t.credit),
    ),
    actualDelta,
    expectedDelta,
    pendingAttribution:
      actualDelta !== null &&
      expectedDelta !== null &&
      Number.isSafeInteger(actualDelta - expectedDelta)
        ? actualDelta - expectedDelta
        : null,
    boundaries: {
      beforeMessageId: before?.id ?? null,
      afterMessageId: after?.id ?? null,
    },
    reconciliation:
      projection.account?.reconciliations.filter(
        (r) =>
          r.field === "gold" &&
          r.source.messageId >= from &&
          r.source.messageId <= through,
      ) ?? [],
    transactions,
    dropsSaleValue: null,
  };
}
export function ledgerRecoveryCycles(
  data: LedgerData,
  projection: ReturnType<typeof projectLedger>,
  bounds: { from: number; through: number },
) {
  const selected = new Map(data.facts.map((f) => [f.observationId, f.facts]));
  const operations = projection.operations
    .filter(
      (o) =>
        o.character === projection.character &&
        o.source &&
        o.source.messageId >= bounds.from &&
        o.source.messageId <= bounds.through,
    )
    .sort((a, b) => (a.source?.messageId ?? 0) - (b.source?.messageId ?? 0));
  const rests = operations.filter(
    (o) => o.command === "/rest" && o.state === "confirmed",
  );
  const cycles = rests.slice(1).map((end, index) => {
    const start = rests[index];
    const between = operations.filter(
      (o) =>
        o.source &&
        o.source.messageId > (start.source?.messageId ?? 0) &&
        o.source.messageId < (end.source?.messageId ?? 0),
    );
    const combats = between.flatMap((o) => {
      const c = ledgerFact<LedgerCombat>(
        selected.get(o.source?.observationId ?? 0) ?? [],
        "combat",
      );
      return c ? [c] : [];
    });
    const damage = combats.flatMap((c) =>
      c.events.filter((e) =>
        [
          "damage",
          "critical_followup",
          "additional_damage",
          "reflection",
        ].includes(e.kind),
      ),
    );
    const known = damage.flatMap((e) =>
      typeof e.actual?.value === "number" ? [e.actual.value] : [],
    );
    return {
      fromMessageId: start.source?.messageId,
      throughMessageId: end.source?.messageId,
      samples: combats.length,
      confirmedMpCost: sum(
        between.flatMap((o) =>
          typeof o.confirmedMpCost === "number" ? [o.confirmedMpCost] : [],
        ),
      ),
      effectiveDamage:
        damage.length > 0 &&
        damage.length === known.length &&
        combats.every((c) => c.complete)
          ? sum(known)
          : null,
      knownPartialDamage: sum(known),
    };
  });
  const known = cycles.flatMap((c) =>
    c.effectiveDamage === null ? [] : [c.effectiveDamage],
  );
  const total = sum(known);
  return {
    cycles,
    completeCycles: cycles.length,
    damagePerCompleteCycle:
      cycles.length > 0 && known.length === cycles.length && total !== null
        ? total / cycles.length
        : null,
    note: "只有兩筆確認恢復之間是完整本機週期；未確認同一 server 挑戰，不代表跨層最佳打法。",
  };
}

export function ledgerDamageComponents(combats: LedgerCombat[]) {
  return Object.fromEntries(
    ["damage", "critical_followup", "additional_damage", "reflection"].map(
      (kind) => {
        const events = combats.flatMap((c) =>
          c.events.filter((e) => e.kind === kind),
        );
        const nominal = events.flatMap((e) =>
          typeof e.nominal?.value === "number" ? [e.nominal.value] : [],
        );
        const actual = events.flatMap((e) =>
          typeof e.actual?.value === "number" ? [e.actual.value] : [],
        );
        const covered = combats.length > 0 && combats.every((c) => c.complete);
        return [
          kind,
          {
            nominal:
              covered && nominal.length === events.length ? sum(nominal) : null,
            actual:
              covered && actual.length === events.length ? sum(actual) : null,
            knownPartialActual: sum(actual),
            events: events.length,
            knownActualEvents: actual.length,
          },
        ];
      },
    ),
  );
}
