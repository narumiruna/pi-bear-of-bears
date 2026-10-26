import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { type Static, Type } from "typebox";
import { Check } from "typebox/value";
import {
  boundedReadonlyResult,
  READONLY_RESULT_SCHEMA,
  type ReadonlyDataResult,
} from "./bears-readonly-result.js";
import type { GameMessage } from "./game.js";
import { toolResult } from "./output.js";
import {
  safeInteger,
  WORKFLOW_RESULT_SCHEMA,
  type WorkflowResult,
} from "./workflow-result.js";

const messageSchema = Type.Object({
  id: safeInteger(1),
  outgoing: Type.Boolean(),
  text: Type.String(),
  date: safeInteger(),
  revision: Type.String(),
  hasMedia: Type.Boolean(),
  buttons: Type.Array(
    Type.Object({
      row: safeInteger(),
      column: safeInteger(),
      text: Type.String(),
      kind: Type.Union([
        Type.Literal("callback"),
        Type.Literal("text"),
        Type.Literal("unsupported"),
      ]),
    }),
  ),
});
const ACCOUNTING_SCHEMA = Type.Object(
  {
    operationId: Type.String({ minLength: 1, maxLength: 128 }),
    state: Type.Union(
      [
        "prepared",
        "submitted",
        "confirmed",
        "rejected",
        "unresolved",
        "not_dispatched",
      ].map((state) => Type.Literal(state)),
    ),
    confirmedMpCost: Type.Union([safeInteger(), Type.Null()]),
    operationalEligibility: Type.Literal(false),
    mpAfter: Type.Union([safeInteger(), Type.Null()]),
    hpAfter: Type.Union([safeInteger(), Type.Null()]),
    complete: Type.Boolean(),
    reasons: Type.Array(Type.String()),
  },
  { additionalProperties: false },
);
/** delivery 與 observation 不證明遊戲操作成功。complete 只描述輸出，非背包資格。 */
export const BEARS_RESULT_SCHEMA = Type.Object(
  {
    version: Type.Literal(1),
    kind: Type.Union([Type.Literal("command"), Type.Literal("history")]),
    originalSourceId: Type.Optional(
      Type.String({ minLength: 1, maxLength: 128 }),
    ),
    delivery: Type.Union([
      Type.Literal("submitted"),
      Type.Literal("not_dispatched"),
      Type.Literal("unknown"),
      Type.Literal("not_applicable"),
    ]),
    observation: Type.Union([
      Type.Literal("bot_updates_observed"),
      Type.Literal("no_update_yet"),
      Type.Literal("history"),
      Type.Literal("unknown"),
    ]),
    outcome: Type.Literal("unknown"),
    code: Type.Union([
      Type.Literal("OUTCOME_UNKNOWN"),
      Type.Literal("OBSERVED"),
      Type.Literal("INVALID_RESULT"),
      Type.Literal("NOT_DISPATCHED"),
      Type.Literal("CANCELLED"),
      Type.Literal("REJECTED"),
    ]),
    messages: Type.Array(messageSchema),
    accounting: Type.Optional(ACCOUNTING_SCHEMA),
    complete: Type.Boolean(),
    reasons: Type.Array(Type.String()),
  },
  { additionalProperties: false },
);
export type BearsResult = Static<typeof BEARS_RESULT_SCHEMA>;
export const DECODED_RESULT_SCHEMA = Type.Union([
  BEARS_RESULT_SCHEMA,
  WORKFLOW_RESULT_SCHEMA,
  READONLY_RESULT_SCHEMA,
]);
type DecodedBearsResult = BearsResult | WorkflowResult | ReadonlyDataResult;

const unknown = (reason: string, sourceId?: string): BearsResult => ({
  version: 1,
  ...(sourceId && sourceId.length <= 128 ? { originalSourceId: sourceId } : {}),
  kind: "command",
  delivery: "unknown",
  observation: "unknown",
  outcome: "unknown",
  code: "INVALID_RESULT",
  messages: [],
  complete: false,
  reasons: [reason],
});
const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

/** 相容舊 JSON 加獨立 source ID；只解碼，不查 history、不重送、不判斷遊戲成功。 */
export function decodeBearsResult(originalInput: unknown): DecodedBearsResult {
  let input = originalInput;
  const object = record(input);
  if (object && "structuredContent" in object) {
    // 宣告過的結構化通道不合法時不得改讀文字，避免掩蓋矛盾。
    return decodeStructured(object.structuredContent);
  }
  if (
    Check(BEARS_RESULT_SCHEMA, input) ||
    Check(WORKFLOW_RESULT_SCHEMA, input) ||
    Check(READONLY_RESULT_SCHEMA, input)
  ) {
    return input as DecodedBearsResult;
  }
  if (object && Array.isArray(object.content)) {
    input = object.content
      .filter((block) => record(block)?.type === "text")
      .map((block) => record(block)?.text)
      .join("\n");
  }
  let sourceId: string | undefined;
  if (typeof input === "string") {
    const suffix = /\n\s*(\{"originalSourceId":"[^"\n]{1,128}"\})\s*$/u.exec(
      input,
    );
    if (suffix) {
      sourceId = JSON.parse(suffix[1]).originalSourceId;
      input = input.slice(0, suffix.index);
    }
    try {
      input = JSON.parse(input as string);
    } catch {
      return unknown("非 JSON 或截斷文字；須查原文，不重送。", sourceId);
    }
  }
  if (Check(READONLY_RESULT_SCHEMA, input)) {
    return {
      ...input,
      ...(sourceId ? { originalSourceId: sourceId } : {}),
    } as ReadonlyDataResult;
  }
  if (Check(WORKFLOW_RESULT_SCHEMA, input)) {
    return {
      ...(input as WorkflowResult),
      ...(sourceId ? { originalSourceId: sourceId } : {}),
    };
  }
  if (Check(BEARS_RESULT_SCHEMA, input)) {
    return input as BearsResult;
  }
  const raw = record(input);
  sourceId ??=
    typeof raw?.originalSourceId === "string" &&
    raw.originalSourceId.length <= 128
      ? raw.originalSourceId
      : undefined;
  const preview =
    raw?.truncated === true ? (record(raw.preview) ?? raw.preview) : input;
  const value = record(preview);
  const messages = Array.isArray(preview) ? preview : value?.messages;
  if (!Check(Type.Array(messageSchema), messages)) {
    return unknown(
      "缺少有效原始 messages；source ID 或 submitted 不能證明成功。",
      sourceId,
    );
  }
  if (
    value?.accounting !== undefined &&
    !Check(ACCOUNTING_SCHEMA, value.accounting)
  ) {
    return unknown("accounting schema 無效；不推餘額，不重送。", sourceId);
  }
  const history = Array.isArray(preview);
  return {
    version: 1,
    kind: history ? "history" : "command",
    ...(sourceId ? { originalSourceId: sourceId } : {}),
    delivery: history
      ? "not_applicable"
      : value?.delivery === "submitted"
        ? "submitted"
        : "unknown",
    observation: history
      ? "history"
      : value?.observation === "bot_updates_observed"
        ? "bot_updates_observed"
        : value?.observation === "no_update_yet"
          ? "no_update_yet"
          : "unknown",
    outcome: "unknown",
    code: history ? "OBSERVED" : "OUTCOME_UNKNOWN",
    messages: messages as GameMessage[],
    ...(Check(ACCOUNTING_SCHEMA, value?.accounting)
      ? { accounting: value.accounting }
      : {}),
    complete: raw?.truncated !== true,
    reasons:
      raw?.truncated === true
        ? ["輸出預覽有省略；不是完整背包或完整操作結果。"]
        : [],
  };
}
function decodeStructured(value: unknown): DecodedBearsResult {
  return Check(BEARS_RESULT_SCHEMA, value) ||
    Check(WORKFLOW_RESULT_SCHEMA, value) ||
    Check(READONLY_RESULT_SCHEMA, value)
    ? (value as DecodedBearsResult)
    : unknown("結構化通道不符合 schema。");
}

function boundedCommandResult(value: BearsResult): BearsResult {
  const result = { ...value };
  while (
    Buffer.byteLength(JSON.stringify(result)) > 44_000 &&
    result.messages.length > 0
  ) {
    result.messages = result.messages.slice(0, -1);
    result.complete = false;
    result.reasons = [
      "結構化輸出省略 messages 尾端；用 originalSourceId 查完整原文。",
    ];
  }
  if (Buffer.byteLength(JSON.stringify(result)) > 44_000) {
    result.complete = false;
    result.reasons = ["結果說明超限；用原文來源查閱完整錯誤，不重送。"];
  }
  return result;
}

/** 保留舊文字消費方式與完整原文；Codemode 直接取得有界結構化通道。 */
export async function gameToolResult(value: unknown) {
  const output = await toolResult(value);
  const full = decodeBearsResult(value);
  if (!Check(BEARS_RESULT_SCHEMA, full) || full.code === "INVALID_RESULT") {
    throw new Error("遊戲結果缺少原始 messages。");
  }
  return {
    ...output,
    structuredContent: boundedCommandResult({
      ...(full as BearsResult),
      originalSourceId: output.details.bearsOriginal.sourceId,
    }),
  };
}

export function registerResultDecoder(pi: ExtensionAPI) {
  pi.registerTool({
    name: "bears_decode_result",
    exposure: "codemode",
    label: "解碼舊遊戲結果",
    description:
      "本機唯讀解碼舊 JSON 文字及獨立 source ID，或驗證結構化結果。不連線、不重送、不由 submitted 或 bot 更新推成功。新指令直接回傳結構化資料，無須呼叫此 tool。",
    parameters: Type.Object(
      { result: Type.Unknown() },
      { additionalProperties: false },
    ),
    outputSchema: DECODED_RESULT_SCHEMA,
    async execute(_id, params) {
      const decoded = decodeBearsResult(params.result);
      const output = await toolResult(decoded);
      const structuredContent = Check(BEARS_RESULT_SCHEMA, decoded)
        ? boundedCommandResult({
            ...(decoded as BearsResult),
            originalSourceId:
              decoded.originalSourceId ?? output.details.bearsOriginal.sourceId,
          })
        : Check(READONLY_RESULT_SCHEMA, decoded)
          ? boundedReadonlyResult(decoded as ReadonlyDataResult)
          : decoded;
      return {
        ...output,
        structuredContent: JSON.parse(JSON.stringify(structuredContent)),
      };
    },
  });
}

export async function gameFailureResult(error: unknown) {
  // 只包裝 Game 提供的 delivery 證據；保留本機 guard 與送出前取消的既有 throw 行為。
  if (
    !(error instanceof Error) ||
    !/Action (?:was not dispatched|may have reached)/u.test(error.message)
  ) {
    throw error;
  }
  return { ...(await gameToolResult(gameErrorResult(error))), isError: true };
}

export function gameErrorResult(error: unknown) {
  const detail = error instanceof Error ? error.message : String(error);
  const notDispatched = /Action was not dispatched to the bot/u.test(detail);
  const accounting = record(error)?.accounting;
  return {
    ...unknown(detail),
    ...(Check(ACCOUNTING_SCHEMA, accounting) ? { accounting } : {}),
    delivery: notDispatched
      ? ("not_dispatched" as const)
      : ("unknown" as const),
    code: notDispatched
      ? ("NOT_DISPATCHED" as const)
      : ("OUTCOME_UNKNOWN" as const),
  };
}
