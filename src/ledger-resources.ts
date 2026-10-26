import { type LedgerBinding, replayTransaction } from "./ledger-attribution.js";
import {
  type LedgerCombat,
  type LedgerRest,
  type LedgerStatus,
  ledgerFact,
} from "./ledger-facts.js";
import type { LedgerObservation } from "./ledger-types.js";
export interface LedgerSource {
  observationId: number;
  messageId: number;
  revision: string;
  date: number;
}
export interface LedgerValue {
  value: number | null;
  basis: "observed" | "derived" | "unknown";
  source: LedgerSource | null;
}
export const unknown = (): LedgerValue => ({
  value: null,
  basis: "unknown",
  source: null,
});
export const ledgerSource = (obs: LedgerObservation): LedgerSource => ({
  observationId: obs.id,
  messageId: obs.message.id,
  revision: obs.message.revision,
  date: obs.message.date,
});
const value = (
  amount: number | null,
  source: LedgerSource,
  basis: LedgerValue["basis"] = "observed",
): LedgerValue => ({
  value: amount,
  basis: amount === null ? "unknown" : basis,
  source,
});
const add = (a: number | null, b: number) =>
  a !== null && Number.isSafeInteger(a + b) ? a + b : null;
export interface Account {
  character: string;
  hp: LedgerValue;
  mp: LedgerValue;
  gold: LedgerValue;
  maxHp: number | null;
  maxMp: number | null;
  lastStatus: { value: LedgerStatus; source: LedgerSource } | null;
  mpSpent: number | null;
  mpRecovered: number | null;
  credits: number | null;
  debits: number | null;
  firstClear: number | null;
  repeatable: number | null;
  recoveryCycles: number;
  transactions: {
    source: LedgerSource;
    credit: number;
    debit: number;
    firstClear: number;
    repeatable: number;
    category: string;
  }[];
  clears: { floor: number; source: LedgerSource }[];
  reconciliations: {
    field: string;
    expected: number;
    observed: number;
    difference: number;
    source: LedgerSource;
  }[];
}
export const account = (character: string): Account => ({
  character,
  hp: unknown(),
  mp: unknown(),
  gold: unknown(),
  maxHp: null,
  maxMp: null,
  lastStatus: null,
  mpSpent: 0,
  mpRecovered: 0,
  credits: 0,
  debits: 0,
  firstClear: 0,
  repeatable: 0,
  recoveryCycles: 0,
  transactions: [],
  clears: [],
  reconciliations: [],
});
export function invalidate(a: Account | undefined, maxima = false) {
  if (!a) {
    return;
  }
  a.hp = unknown();
  a.mp = unknown();
  a.gold = unknown();
  if (maxima) {
    a.maxHp = null;
    a.maxMp = null;
  }
}
export function changeGold(
  a: Account,
  credit: number,
  debit: number,
  source: LedgerSource,
  classification = { firstClear: 0, repeatable: 0, category: "unknown" },
) {
  a.transactions.push({ source, credit, debit, ...classification });
  a.firstClear = add(a.firstClear, classification.firstClear);
  a.repeatable = add(a.repeatable, classification.repeatable);
  a.credits = add(a.credits, credit);
  a.debits = add(a.debits, debit);
  const next = a.gold.value === null ? null : a.gold.value + (credit - debit);
  a.gold = value(
    next !== null && Number.isSafeInteger(next) && next >= 0 ? next : null,
    source,
    "derived",
  );
}

export function observeStatus(
  a: Account,
  status: LedgerStatus,
  source: LedgerSource,
  clockInvalid: boolean,
) {
  for (const field of ["hp", "mp", "gold"] as const) {
    const observed = status[field],
      expected = a[field].value;
    if (observed !== null && expected !== null && observed !== expected) {
      a.reconciliations.push({
        field,
        expected,
        observed,
        difference: observed - expected,
        source,
      });
    }
    a[field] = clockInvalid ? unknown() : value(observed, source);
  }
  a.maxHp = clockInvalid ? null : status.maxHp;
  a.maxMp = clockInvalid ? null : status.maxMp;
  a.lastStatus = { value: status, source };
}
export function applyReceipt(
  a: Account,
  binding: LedgerBinding,
  obs: LedgerObservation,
  facts: Parameters<typeof ledgerFact>[0],
  all: Map<number, typeof facts>,
) {
  const source = ledgerSource(obs);
  const cost = ledgerFact<{ amount: number }>(facts, "mp_cost");
  const combat = ledgerFact<LedgerCombat>(facts, "combat");
  if (cost) {
    a.mpSpent = add(a.mpSpent, cost.amount);
    const mp = a.mp.value === null ? null : a.mp.value - cost.amount;
    a.mp = value(
      combat?.complete && mp !== null && mp >= 0 && Number.isSafeInteger(mp)
        ? mp
        : null,
      source,
      "derived",
    );
  }
  if (combat) {
    if (combat.complete) {
      const hp = combat.events
        .filter(
          (e) =>
            ["initiative", "counter", "hp_cost", "healing"].includes(e.kind) &&
            e.hpAfter?.value !== null &&
            e.hpAfter?.value !== undefined,
        )
        .at(-1);
      a.hp = value(hp?.hpAfter?.value ?? null, source);
      if (typeof hp?.maxHp?.value === "number") {
        a.maxHp = hp.maxHp.value;
      }
    } else {
      a.hp = unknown();
      a.mp = unknown();
    }
    if (!binding.supplement && combat.rewardGold.value !== null) {
      changeGold(a, combat.rewardGold.value, 0, source, {
        firstClear: 0,
        repeatable: combat.rewardGold.value,
        category: "battle",
      });
    }
  }
  const rejection = ledgerFact<{ current: number }>(facts, "mp_rejected");
  if (rejection) {
    a.mp = value(rejection.current, source);
    if (a.maxMp !== null && rejection.current > a.maxMp) {
      a.maxMp = null;
    }
  }
  const rest = ledgerFact<LedgerRest>(facts, "rest");
  if (rest) {
    const before = a.mp.value;
    if (rest.format === "native") {
      a.maxHp = rest.maxHp;
      a.maxMp = rest.maxMp;
      a.hp = value(rest.hp, source);
      a.mp = value(rest.mp, source);
      // 原生回覆沒有價格或錢包欄位，不將補滿推成零費用。
      a.gold = unknown();
    } else {
      a.hp = value(a.maxHp, source, "derived");
      a.mp = value(a.maxMp, source, "derived");
    }
    a.mpRecovered =
      before !== null && a.maxMp !== null && a.maxMp >= before
        ? add(a.mpRecovered, a.maxMp - before)
        : null;
    a.recoveryCycles++;
  }
  const clear = ledgerFact<{
    floor: number;
    repeatable: number;
    firstClear: number;
    total: number;
  }>(facts, "tower_clear");
  if (clear) {
    const prior = binding.reply
      ? ledgerFact<LedgerCombat>(all.get(binding.reply.id) ?? [], "combat")
      : null;
    if (
      prior?.rewardGold.value !== null &&
      prior?.rewardGold.value !== undefined &&
      prior.rewardGold.value !== clear.repeatable
    ) {
      a.gold = unknown();
      return;
    }
    changeGold(a, clear.total, 0, source, {
      firstClear: clear.firstClear,
      repeatable: clear.repeatable,
      category: "tower",
    });
    a.clears.push({ floor: clear.floor, source });
  }
  const transaction =
    !clear && !combat ? replayTransaction(obs, binding.command) : null;
  if (transaction) {
    changeGold(a, transaction.credit, transaction.debit, source, {
      firstClear: transaction.category === "one_time" ? transaction.credit : 0,
      repeatable: transaction.category === "one_time" ? 0 : transaction.credit,
      category: transaction.category,
    });
  }
  if (
    !cost &&
    !combat &&
    !rejection &&
    !clear &&
    !ledgerFact(facts, "rest") &&
    !transaction &&
    !ledgerFact(facts, "tower")
  ) {
    invalidate(a);
  }
}
