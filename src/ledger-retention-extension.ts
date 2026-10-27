import { resolve } from "node:path";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { fingerprint } from "./ledger-facts.js";
import { ledgerToolOutput } from "./ledger-query.js";
import { prepareRetention, type RetentionPlan } from "./ledger-retention.js";
import {
  type RetentionUsage,
  retentionModelCall,
  totalRetentionUsage,
} from "./ledger-retention-agent.js";
import { compactLedger } from "./ledger-retention-run.js";
import { publishRetentionWiki } from "./ledger-retention-wiki.js";
import type { LedgerRuntime } from "./ledger-runtime.js";
import { RecordsStore } from "./records-store.js";

/** 明確啟用後才在安全邊界壓縮；factory、reload與session_start不啟動模型。 */
export function registerLedgerRetention(
  pi: ExtensionAPI,
  current: () => LedgerRuntime | undefined,
) {
  let controller: AbortController | undefined,
    autoFailed = false;
  const previews = new Map<
    string,
    { runtime: string; at: number; plan: RetentionPlan }
  >();
  pi.registerTool({
    name: "bears_ledger_compaction_preview",
    label: "預覽帳本壓縮範圍",
    exposure: "codemode",
    description:
      "唯讀預覽全帳本較舊約半量候選，按event ID分頁，不呼叫模型、不刪資料、不建立操作資格。續頁須帶snapshot，60秒過期。",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    parameters: Type.Object(
      {
        snapshot: Type.Optional(Type.String({ pattern: "^[a-f0-9]{64}$" })),
        offset: Type.Optional(
          Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
        ),
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
      },
      { additionalProperties: false },
    ),
    outputSchema: Type.Object(
      {
        version: Type.Literal(1),
        operationalEligibility: Type.Literal(false),
        data: Type.Unknown(),
      },
      { additionalProperties: false },
    ),
    execute: (_id, args, signal) =>
      Promise.resolve().then(() => {
        signal?.throwIfAborted();
        const runtime = current();
        if (!runtime) {
          throw new Error("尚無已識別帳本；不為預覽登入。");
        }
        const offset = args.offset ?? 0,
          limit = args.limit ?? 50;
        if (offset > 0 && !args.snapshot) {
          throw new Error("候選續頁須帶snapshot。");
        }
        let key = args.snapshot,
          cached = key ? previews.get(key) : undefined;
        if (
          key &&
          (!cached ||
            cached.runtime !== runtime.runtime ||
            Date.now() - cached.at > 60000)
        ) {
          throw new Error("預覽snapshot已過期或不屬目前runtime。");
        }
        if (!key) {
          const plan = prepareRetention(runtime.store);
          if (!plan) {
            return ledgerToolOutput({
              version: 1,
              operationalEligibility: false,
              data: { state: "not_needed" },
            });
          }
          key = fingerprint(plan);
          cached = { runtime: runtime.runtime, at: Date.now(), plan };
          previews.set(key, cached);
          while (previews.size > 2) {
            const first = previews.keys().next().value;
            if (first) {
              previews.delete(first);
            }
          }
        }
        if (!cached) {
          throw new Error("缺少預覽資料。");
        }
        const plan = cached.plan,
          end = Math.min(plan.eventIds.length, offset + limit);
        return ledgerToolOutput({
          version: 1,
          operationalEligibility: false,
          data: {
            state: "ready",
            snapshot: key,
            planId: plan.id,
            through: plan.through,
            selectedEvents: plan.eventIds.length,
            selectedContexts: plan.contexts.length,
            checkpointEvents: plan.checkpointEvents.length,
            summaryInputBytes: Buffer.byteLength(plan.digest),
            offset,
            eventIds: plan.eventIds.slice(offset, end),
            nextOffset: end < plan.eventIds.length ? end : null,
            note: "固定歷史候選，不代表目前來源未變或已授權提交。",
          },
        });
      }),
  });
  async function run(ctx: ExtensionContext, signal?: AbortSignal) {
    if (process.env.BEARS_LEDGER_RETENTION !== "1") {
      throw new Error(
        "帳本自動整理尚未啟用；正式紀錄庫與切換條件核定後設定BEARS_LEDGER_RETENTION=1。",
      );
    }
    const runtime = current();
    if (!runtime) {
      throw new Error("尚無已識別帳本；不為壓縮登入Telegram。");
    }
    if (controller) {
      throw new Error("已有壓縮工作；未重複spawn。");
    }
    controller = new AbortController();
    const active = controller;
    const generation = runtime.generation;
    let records: RecordsStore | undefined;
    const usage: RetentionUsage[] = [];
    try {
      records = new RecordsStore(
        process.env.BEARS_RECORDS_PATH ??
          resolve(ctx.cwd, ".pi/records/records.sqlite"),
        { create: false },
      );
      const model = retentionModelCall(ctx);
      const result = await compactLedger(
        runtime,
        records,
        async (input) => {
          const reply = await model(input);
          usage.push(reply.usage);
          return reply;
        },
        {
          publishWiki: (candidates) =>
            publishRetentionWiki(candidates, ctx.cwd),
          signal: AbortSignal.any([active.signal, ...(signal ? [signal] : [])]),
        },
      );
      autoFailed = false;
      return {
        ...ledgerToolOutput({
          version: 1,
          operationalEligibility: false,
          data: result,
        }),
        usage: totalRetentionUsage(usage),
      };
    } catch (error) {
      return {
        ...ledgerToolOutput({
          version: 1,
          operationalEligibility: false,
          data: {
            state: "stopped",
            reason:
              error instanceof Error
                ? error.message
                : "壓縮未完成；請查checkpoint，不盲目重試。",
          },
        }),
        isError: true,
        usage: totalRetentionUsage(usage),
      };
    } finally {
      try {
        records?.close();
      } finally {
        if (controller === active) {
          controller = undefined;
        }
        const total = totalRetentionUsage(usage);
        if (total && runtime.generation === generation) {
          runtime.usage(total);
        }
      }
    }
  }
  pi.registerTool({
    name: "bears_ledger_compact",
    label: "壓縮歷史帳本",
    exposure: "codemode",
    description:
      "在明確啟用的本機帳本達180000事件時，用無工具subagent整理最舊約半量；摘要落盤、備份與精確重播核驗後永久刪除舊事件。未決保留；不查Telegram、不續戰。",
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: true,
    },
    parameters: Type.Object({}, { additionalProperties: false }),
    outputSchema: Type.Object(
      {
        version: Type.Literal(1),
        operationalEligibility: Type.Literal(false),
        data: Type.Unknown(),
      },
      { additionalProperties: false },
    ),
    execute: (_id, _args, signal, _update, ctx) => run(ctx, signal),
  });
  pi.on("session_start", () => {
    previews.clear();
    autoFailed = false;
  });
  pi.on("session_tree", () => {
    previews.clear();
    controller?.abort();
    autoFailed = false;
  });
  pi.on("session_shutdown", () => {
    previews.clear();
    controller?.abort();
  });
  pi.on("agent_before_settle", async (_event, ctx) => {
    const runtime = current();
    if (
      process.env.BEARS_LEDGER_RETENTION !== "1" ||
      autoFailed ||
      !runtime ||
      controller
    ) {
      return;
    }
    const count = Number(
      runtime.store.db.prepare("SELECT COUNT(*) n FROM events").get()?.n,
    );
    if (count < 180000) {
      return;
    }
    try {
      const result = await run(ctx, ctx.signal);
      if (
        ("isError" in result && result.isError) ||
        result.structuredContent.data.state !== "confirmed"
      ) {
        autoFailed = true;
      }
      pi.sendMessage(
        {
          customType: "bears-ledger-compaction",
          content: result.content[0].text,
          display: true,
        },
        { triggerTurn: false },
      );
    } catch {
      autoFailed = true;
      if (ctx.hasUI) {
        ctx.ui.notify(
          "帳本壓縮未完成；不刪資料、不自動重試或續戰。",
          "warning",
        );
      }
    }
  });
}
