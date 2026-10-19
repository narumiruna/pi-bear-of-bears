import type { JsonValue } from "@earendil-works/pi-ai";
import { type Static, Type } from "typebox";
import { toolResult } from "./output.js";

/** 只描述輸出是否完整；不表示背包、本人資格、公開來源時效或可執行性。 */
export const READONLY_RESULT_SCHEMA = Type.Object(
  {
    resultKind: Type.Literal("read_only_data"),
    originalSourceId: Type.String({ minLength: 1, maxLength: 128 }),
    outputComplete: Type.Boolean(),
    outputReasons: Type.Array(Type.String()),
  },
  { additionalProperties: true },
);
export type ReadonlyDataResult = Static<typeof READONLY_RESULT_SCHEMA> &
  Record<string, JsonValue>;

export function boundedReadonlyResult(
  value: ReadonlyDataResult,
): ReadonlyDataResult {
  if (Buffer.byteLength(JSON.stringify(value)) <= 44_000) {
    return value;
  }
  return {
    resultKind: "read_only_data",
    originalSourceId: value.originalSourceId,
    outputComplete: false,
    outputReasons: [
      "唯讀 payload 超限，已省略；以 originalSourceId 查完整原文。省略不表示空結果、完整背包或可套用推薦。",
    ],
  };
}

/** 保留原有 root 欄位與舊 content，僅讓 Codemode 直接消費物件；不改資料或快取。 */
export async function readonlyToolResult(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("唯讀查詢結果須為物件。");
  }
  const output = await toolResult(value);
  const metadata = {
    resultKind: "read_only_data" as const,
    originalSourceId: output.details.bearsOriginal.sourceId,
    outputComplete: true,
    outputReasons: [] as string[],
  };
  // JSON round-trip 與舊文字通道一致，不將 undefined 或私有 details 送進 VM。
  const structuredContent = boundedReadonlyResult({
    ...JSON.parse(output.details.bearsOriginal.text),
    ...metadata,
  });
  return { ...output, structuredContent };
}
