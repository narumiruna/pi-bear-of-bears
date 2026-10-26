import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { ledgerCheckpoint } from "./ledger-checkpoint.js";
import { LedgerPages } from "./ledger-pages.js";
import {
  LEDGER_PAGE_SCHEMA,
  LEDGER_STATUS_SCHEMA,
  ledgerStatus,
  ledgerToolOutput,
} from "./ledger-query.js";
import { ledgerReport } from "./ledger-report.js";
import type { LedgerRuntime } from "./ledger-runtime.js";

const number = (minimum = 0) =>
  Type.Integer({ minimum, maximum: Number.MAX_SAFE_INTEGER });
const character = Type.Optional(Type.String({ minLength: 1, maxLength: 80 }));
const pageFields = {
  offset: Type.Optional(number()),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 6000 })),
  snapshot: Type.Optional(Type.String({ pattern: "^[a-f0-9]{64}$" })),
};
const readonly = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};
const requireLedger = (
  get: () => LedgerRuntime | undefined,
  diagnostics: () => string[],
) => {
  const runtime = get();
  if (!runtime) {
    throw new Error(diagnostics().join("\n") || "帳本尚未啟用。");
  }
  return runtime;
};

function registerTraceTools(
  pi: ExtensionAPI,
  getRuntime: () => LedgerRuntime | undefined,
  getDiagnostics: () => string[],
  pages: LedgerPages,
  enabled: () => boolean,
) {
  const requireRuntime = () => requireLedger(getRuntime, getDiagnostics);
  pi.registerTool({
    name: "bears_ledger_status",
    exposure: "codemode",
    label: "歷史帳本狀態",
    annotations: readonly,
    description:
      "唯讀本機 SQLite 的角色資源、確認成本、未決及缺口。不連線 Telegram、不刷新操作資格。成本不等於餘額；unknown 不補零。",
    parameters: Type.Object({ character }, { additionalProperties: false }),
    outputSchema: LEDGER_STATUS_SCHEMA,
    execute: (_id, params, signal) =>
      Promise.resolve().then(() => {
        signal?.throwIfAborted();
        return ledgerToolOutput(
          ledgerStatus(
            getRuntime(),
            params.character,
            getDiagnostics(),
            enabled(),
          ),
        );
      }),
  });
  pi.registerTool({
    name: "bears_ledger_trace",
    exposure: "codemode",
    label: "追查帳本原文",
    annotations: readonly,
    description:
      "唯讀本分支的 observationId 原文／parser 版本，或 operationId 的送達狀態與完整來源鏈。不接受 SQL／路徑。offset 為零起算 Unicode code point，依 nextOffset 串接 JSON；舊原文不是即時操作資格。",
    parameters: Type.Union([
      Type.Object(
        { observationId: number(1), ...pageFields },
        { additionalProperties: false },
      ),
      Type.Object(
        {
          operationId: Type.String({ pattern: "^[a-f0-9-]{36}$" }),
          ...pageFields,
        },
        { additionalProperties: false },
      ),
    ]),
    outputSchema: LEDGER_PAGE_SCHEMA,
    execute: (_id, params, signal) =>
      Promise.resolve().then(() => {
        signal?.throwIfAborted();
        const key = `trace:${"observationId" in params ? params.observationId : params.operationId}`;
        return ledgerToolOutput(
          pages.page(
            "trace",
            key,
            () => {
              const ledger = requireRuntime(),
                data = ledger.read();
              let result: unknown;
              if ("observationId" in params) {
                if (
                  !data.observations.some((o) => o.id === params.observationId)
                ) {
                  throw new Error("目前分支沒有此原文引用。");
                }
                result = ledger.store.trace(params.observationId);
              } else {
                const operation = data.operations.find(
                  (o) => o.id === params.operationId,
                );
                if (!operation) {
                  throw new Error("目前分支沒有此 operation ID。");
                }
                const events = data.events.filter(
                    (e) => e.operationId === operation.id,
                  ),
                  ids = new Set(
                    events
                      .filter((e) => e.kind === "seen")
                      .map((e) => Number(e.data.observationId)),
                  );
                result = {
                  operation,
                  events,
                  observations: data.observations.filter((o) => ids.has(o.id)),
                  facts: data.facts.filter((f) => ids.has(f.observationId)),
                };
              }

              return result;
            },
            params,
          ),
        );
      }),
  });
}
function registerReportTools(
  pi: ExtensionAPI,
  getRuntime: () => LedgerRuntime | undefined,
  getDiagnostics: () => string[],
  pages: LedgerPages,
) {
  const requireRuntime = () => requireLedger(getRuntime, getDiagnostics);
  pi.registerTool({
    name: "bears_ledger_report",
    exposure: "codemode",
    label: "帳本與條件化效率報表",
    annotations: readonly,
    description:
      "唯讀指定角色／訊息區間的成本、已知削血、條件差異、對帳與 operation ID 關聯耗時。模型成本只列實得 usage；首達與可重複收益分開。缺值、未知防護或挑戰 ID 不補猜，不作安全批准。以 nextOffset 分頁，不查 Telegram。",
    parameters: Type.Object(
      {
        character,
        fromMessageId: Type.Optional(number()),
        throughMessageId: Type.Optional(number()),
        afterObservationId: Type.Optional(number()),
        ...pageFields,
      },
      { additionalProperties: false },
    ),
    outputSchema: LEDGER_PAGE_SCHEMA,
    execute: (_id, params, signal) =>
      Promise.resolve().then(() => {
        signal?.throwIfAborted();
        return ledgerToolOutput(
          pages.page(
            "report",
            JSON.stringify({
              character: params.character,
              fromMessageId: params.fromMessageId,
              throughMessageId: params.throughMessageId,
              afterObservationId: params.afterObservationId,
            }),
            () => ledgerReport(requireRuntime().read(), params),
            params,
          ),
        );
      }),
  });
  pi.registerTool({
    name: "bears_ledger_checkpoint",
    exposure: "codemode",
    label: "帳本檢查點預覽",
    annotations: readonly,
    description:
      "由同一投影產生最多 2400 字的歷史檢查點，只預覽、不改檔、不查 Telegram；面板與續行文件可共用。明確匯出須由使用者執行 /bears-ledger export-preview，再 export-write；不覆寫人工修改或 GOAL.md。",
    parameters: Type.Object({ character }, { additionalProperties: false }),
    outputSchema: Type.Object(
      {
        version: Type.Literal(1),
        operationalEligibility: Type.Literal(false),
        text: Type.String({ maxLength: 2400 }),
      },
      { additionalProperties: false },
    ),
    execute: (_id, params, signal) =>
      Promise.resolve().then(() => {
        signal?.throwIfAborted();
        return ledgerToolOutput({
          version: 1 as const,
          operationalEligibility: false as const,
          text: ledgerCheckpoint(requireRuntime().read(), params.character),
        });
      }),
  });
}
export function registerLedgerTools(
  pi: ExtensionAPI,
  getRuntime: () => LedgerRuntime | undefined,
  getDiagnostics: () => string[],
  enabled = () => getRuntime() !== undefined,
) {
  const pages = new LedgerPages();
  registerTraceTools(pi, getRuntime, getDiagnostics, pages, enabled);
  registerReportTools(pi, getRuntime, getDiagnostics, pages);
  return () => pages.reset();
}
