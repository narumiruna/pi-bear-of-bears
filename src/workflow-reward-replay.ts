import type { Observation } from "./workflow-observation-types.js";
import { numberValue } from "./workflow-parser-values.js";
import type { RewardEvent } from "./workflow-reward-ledger.js";

/** 只支援既有標籤式存款 fixture；未列費用不當成零費用。 */
export function replayDepositFee(record: Observation): RewardEvent | null {
  const request = /^\/deposit ([\d,]+)$/u.exec(record.command ?? "");
  const receipt =
    /^存款成功[：:]\s*([\d,]+)\s*G\r?\n(?:存款手續費|手續費)[：:]\s*([\d,]+)\s*G$/u.exec(
      record.message.text.trim(),
    );
  if (!request || !receipt) {
    return null;
  }
  const requested = numberValue(request[1]);
  const deposited = numberValue(receipt[1]);
  const fee = numberValue(receipt[2]);
  return requested !== null &&
    requested > 0 &&
    deposited === requested &&
    fee !== null
    ? {
        source: record.message.id,
        revision: record.message.revision,
        category: "deposit_fee",
        credit: 0,
        debit: fee,
        format: "labelled_replay",
      }
    : null;
}

type Field = "credit" | "total" | "base" | "tax";
const fields: [Field, RegExp][] = [
  ["credit", /^(?:獲得金幣[：:]\s*|金幣\s*\+\s*)([\d,]+)\s*G?$/u],
  ["total", /^(?:實際費用|實際支出|總支出)[：:]\s*([\d,]+)\s*G$/u],
  ["base", /^(?:(?:消耗金幣|花費金幣)[：:]?\s*|金幣\s*-\s*)([\d,]+)\s*G$/u],
  ["tax", /^(?:稅費|手續費)[：:]\s*([\d,]+)\s*G$/u],
];

/** 既有標籤式 replay 的完整金幣回執；不當成 native 世界／工藝格式。
 * 整份訊息必須都是唯一且合法的欄位，不能從否定、資格預告或未知尾文摘取金額。
 */
export function replayRewardEvent(
  record: Observation,
  blockers: string[],
): RewardEvent | null {
  if (
    !/^\/(?:attack|skill|quest|stopidle|forge|refine|craft|tower)(?:\s|$)/u.test(
      record.command ?? "",
    )
  ) {
    return null;
  }
  const values: Record<Field, number | null> = {
    credit: null,
    total: null,
    base: null,
    tax: null,
  };
  const lines = record.message.text
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) {
    return null;
  }
  let oneTime = false;
  for (const line of lines) {
    const prefix = /^(?:首達|首次|寶箱)(?=獲得金幣)/u.exec(line);
    const normalized = prefix ? line.slice(prefix[0].length) : line;
    const matched = fields
      .map(([field, pattern]) => ({ field, match: pattern.exec(normalized) }))
      .find((entry) => entry.match);
    if (!matched?.match) {
      return null;
    }
    const value = numberValue(matched.match[1]);
    if (value === null || values[matched.field] !== null) {
      blockers.push(
        `回執 ${record.message.id} 的金額無效或欄位重複，不計為已確認收支。`,
      );
      return null;
    }
    oneTime ||= prefix !== null;
    values[matched.field] = value;
  }
  const { credit, total, base, tax } = values;
  const hasDebit = total !== null || base !== null || tax !== null;
  if (hasDebit && total === null && (base === null || tax === null)) {
    blockers.push(
      `回執 ${record.message.id} 缺少實際總額或明列基價／稅費，不假設漏列稅費為零。`,
    );
    return null;
  }
  if (
    total !== null &&
    ((base !== null && total < base) ||
      (tax !== null && total < tax) ||
      (base !== null && tax !== null && total !== base + tax))
  ) {
    blockers.push(
      `回執 ${record.message.id} 的實際總額與基價／稅費矛盾，不計為已確認支出。`,
    );
    return null;
  }
  const debit = total ?? (base ?? 0) + (tax ?? 0);
  if (!Number.isSafeInteger(debit)) {
    blockers.push(`回執 ${record.message.id} 的支出超過安全整數範圍。`);
    return null;
  }
  return {
    source: record.message.id,
    revision: record.message.revision,
    category: oneTime
      ? "one_time"
      : /^\/(?:forge|refine|craft)(?:\s|$)/u.test(record.command ?? "")
        ? "upgrade"
        : "battle",
    credit: credit ?? 0,
    debit,
    format: "labelled_replay",
  };
}
