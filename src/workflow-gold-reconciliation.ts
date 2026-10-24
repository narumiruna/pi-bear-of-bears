import type { RewardEvent } from "./workflow-reward-ledger.js";

const MAX = BigInt(Number.MAX_SAFE_INTEGER);
const safeNumber = (value: bigint | null) =>
  value !== null && value >= -MAX && value <= MAX ? Number(value) : null;

/** 已驗證個別金額才可合計；超界只限制相應數值，不抹掉其他已知證據。 */
export function goldReconciliation(
  actual: bigint | null,
  events: Pick<RewardEvent, "credit" | "debit">[],
) {
  let credit = 0n,
    debit = 0n;
  for (const event of events) {
    if (
      ![event.credit, event.debit].every(
        (value) => Number.isSafeInteger(value) && value >= 0,
      )
    ) {
      throw new Error("個別收支金額未經安全整數驗證。");
    }
    credit += BigInt(event.credit);
    debit += BigInt(event.debit);
  }
  const pending = actual === null ? null : actual - credit + debit;
  const actualDelta = safeNumber(actual),
    credits = safeNumber(credit),
    debits = safeNumber(debit),
    unexplained = safeNumber(pending);
  const overflow = {
    actualDelta: actual !== null && actualDelta === null,
    credits: credits === null,
    debits: debits === null,
    unexplained: pending !== null && unexplained === null,
  };
  return {
    actualDelta,
    credits,
    debits,
    unexplained,
    overflow,
    exact: {
      actualDelta: actual?.toString() ?? null,
      credits: credit.toString(),
      debits: debit.toString(),
      unexplained: pending?.toString() ?? null,
    },
    hasOverflow: Object.values(overflow).some(Boolean),
  };
}
