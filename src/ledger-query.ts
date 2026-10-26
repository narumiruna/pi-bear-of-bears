import { Type } from "typebox";
import { fingerprint } from "./ledger-facts.js";
import { projectLedger } from "./ledger-projection.js";
import type { LedgerRuntime } from "./ledger-runtime.js";
import { LEDGER_PARSER_VERSION } from "./ledger-types.js";

const integer = () =>
  Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
const nullable = () => Type.Union([integer(), Type.Null()]);
const source = Type.Union([
  Type.Null(),
  Type.Object(
    {
      observationId: integer(),
      messageId: integer(),
      revision: Type.String(),
      date: integer(),
    },
    { additionalProperties: false },
  ),
]);
const resource = Type.Object(
  {
    value: nullable(),
    basis: Type.Union([
      Type.Literal("observed"),
      Type.Literal("derived"),
      Type.Literal("unknown"),
    ]),
    source,
  },
  { additionalProperties: false },
);
export const LEDGER_STATUS_SCHEMA = Type.Object(
  {
    version: Type.Literal(1),
    parserVersion: Type.Literal(LEDGER_PARSER_VERSION),
    enabled: Type.Boolean(),
    operationalEligibility: Type.Literal(false),
    character: Type.Union([Type.String(), Type.Null()]),
    resources: Type.Object(
      { hp: resource, mp: resource, gold: resource },
      { additionalProperties: false },
    ),
    totals: Type.Object(
      {
        mpSpent: nullable(),
        mpRecovered: nullable(),
        credits: nullable(),
        debits: nullable(),
        firstClear: nullable(),
        repeatable: nullable(),
      },
      { additionalProperties: false },
    ),
    pending: Type.Array(Type.String(), { maxItems: 20 }),
    pendingTotal: integer(),
    conflicts: Type.Array(integer(), { maxItems: 20 }),
    externalEvents: integer(),
    gaps: Type.Array(
      Type.Object(
        {
          messageId: Type.Union([integer(), Type.Null()]),
          reason: Type.String(),
        },
        { additionalProperties: false },
      ),
      { maxItems: 20 },
    ),
    gapsTotal: integer(),
    diagnostics: Type.Array(Type.String(), { maxItems: 10 }),
    note: Type.String(),
  },
  { additionalProperties: false },
);
export const LEDGER_PAGE_SCHEMA = Type.Object(
  {
    version: Type.Literal(1),
    parserVersion: Type.Literal(LEDGER_PARSER_VERSION),
    operationalEligibility: Type.Literal(false),
    kind: Type.Union([Type.Literal("trace"), Type.Literal("report")]),
    format: Type.Literal("json_fragment"),
    snapshot: Type.String({ pattern: "^[a-f0-9]{64}$" }),
    offset: integer(),
    nextOffset: Type.Union([integer(), Type.Null()]),
    totalCodePoints: integer(),
    text: Type.String({ maxLength: 6000 }),
    note: Type.String(),
  },
  { additionalProperties: false },
);
export function ledgerPage(
  kind: "trace" | "report",
  data: unknown,
  offset = 0,
  limit = 4000,
) {
  const points = Array.from(JSON.stringify(data));
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 6000
  ) {
    throw new Error("分頁參數無效。");
  }
  return {
    version: 1 as const,
    parserVersion: LEDGER_PARSER_VERSION,
    operationalEligibility: false as const,
    kind,
    format: "json_fragment" as const,
    snapshot: fingerprint(data),
    offset,
    nextOffset: offset + limit < points.length ? offset + limit : null,
    totalCodePoints: points.length,
    text: points.slice(offset, offset + limit).join(""),
    note: "零起算 Unicode code point；片段不一定是完整 JSON。串接各頁 text；續頁須附同一 snapshot；片段不刷新操作資格。",
  };
}
export function ledgerStatus(
  runtime?: LedgerRuntime,
  character?: string,
  diagnostics: string[] = [],
  enabled = runtime !== undefined,
) {
  const p = runtime ? projectLedger(runtime.read(), character) : null,
    a = p?.account;
  const empty = () => ({
    value: null,
    basis: "unknown" as const,
    source: null,
  });
  return {
    version: 1 as const,
    parserVersion: LEDGER_PARSER_VERSION,
    enabled,
    operationalEligibility: false as const,
    character: p?.character ?? null,
    resources: {
      hp: a?.hp ?? empty(),
      mp: a?.mp ?? empty(),
      gold: a?.gold ?? empty(),
    },
    totals: {
      mpSpent: a?.mpSpent ?? null,
      mpRecovered: a?.mpRecovered ?? null,
      credits: a?.credits ?? null,
      debits: a?.debits ?? null,
      firstClear: a?.firstClear ?? null,
      repeatable: a?.repeatable ?? null,
    },
    pending: p?.pending.slice(-20) ?? [],
    pendingTotal: p?.pending.length ?? 0,
    conflicts: p?.conflicts.slice(-20) ?? [],
    externalEvents: p?.externalEvents ?? 0,
    gaps: p?.gaps.slice(-20) ?? [],
    gapsTotal: p?.gaps.length ?? 0,
    diagnostics: [...diagnostics, ...(p?.diagnostics ?? [])].slice(-10),
    note:
      p?.note ??
      (enabled
        ? "帳本已啟用，尚無可讀的本人帳本；詳見 diagnostics，沒有查詢 Telegram。"
        : "帳本未啟用或不可用；沒有查詢 Telegram。"),
  };
}
export const ledgerToolOutput = <T>(data: T) => {
  const text = JSON.stringify(data);
  if (Buffer.byteLength(text) > 44_000) {
    throw new Error("帳本輸出超限；請縮小區間或改用 trace 分頁。");
  }
  return {
    content: [{ type: "text" as const, text }],
    details: {},
    structuredContent: JSON.parse(text),
  };
};
