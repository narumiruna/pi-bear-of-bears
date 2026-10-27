import { unlinkSync } from "node:fs";
import {
  commitRetention,
  prepareRetention,
  type RetentionPlan,
} from "./ledger-retention.js";
import {
  type PublicRetentionSource,
  type RetentionModelCall,
  summarizeRetention,
} from "./ledger-retention-agent.js";
import type { LedgerRuntime } from "./ledger-runtime.js";
import type { RecordsStore } from "./records-store.js";

/** 公開候選只接受由呼叫端提供的公開原文逐字引用，不把私人摘要自動升格為Wiki。 */
export function validatePublicRetention(
  summaries: Awaited<ReturnType<typeof summarizeRetention>>["summaries"],
  sources: PublicRetentionSource[],
) {
  const allowed = new Map(sources.map((s) => [s.id, s]));
  return summaries
    .flatMap((s) => s.wiki)
    .map((candidate) => {
      const source = allowed.get(candidate.sourceId);
      if (
        source?.url !== "https://bearofbears.net/bears-life-codex/" ||
        !source.text.includes(candidate.quote) ||
        !/^\d{4}-\d{2}-\d{2}$/u.test(source.observedDate)
      ) {
        throw new Error("Wiki候選缺公開來源或不是逐字引用；不刪帳。");
      }
      return {
        quote: candidate.quote,
        source: {
          id: source.id,
          url: source.url,
          observedDate: source.observedDate,
        },
      };
    });
}
interface RetentionOptions {
  minimumEvents?: number;
  signal?: AbortSignal;
  publicSources?: PublicRetentionSource[];
  publishWiki?: (
    candidates: ReturnType<typeof validatePublicRetention>,
  ) => Promise<void>;
}
async function saveSummary(
  records: RecordsStore,
  plan: RetentionPlan,
  model: RetentionModelCall,
  options: RetentionOptions,
  signal: AbortSignal,
) {
  const key = `ledger-compaction:${plan.id}`;
  const saved = records.db
    .prepare("SELECT record_id,revision FROM requests WHERE key=?")
    .get(key);
  if (saved) {
    const row = records.read(String(saved.record_id), Number(saved.revision));
    if (
      !row.sources?.includes(key) ||
      !row.body.includes(plan.digest) ||
      !row.body.includes(plan.sourceHash)
    ) {
      throw new Error("既有compaction摘要與manifest不符；不刪帳。");
    }
    return { reference: records.reference(row.id, row.revision), usage: [] };
  }
  const { summaries, usage } = await summarizeRetention(
    plan,
    model,
    options.publicSources,
    signal,
  );
  signal.throwIfAborted();
  const wiki = validatePublicRetention(summaries, options.publicSources ?? []);
  if (wiki.length > 0 && !options.publishWiki) {
    throw new Error("缺少已核定的Wiki寫入者；不刪帳。");
  }
  if (wiki.length > 0) {
    await options.publishWiki?.(wiki);
  }
  signal.throwIfAborted();
  const characters = JSON.parse(plan.digest).characters.map(
    (c: { character: string }) => c.character,
  ) as string[];
  const body = [
    ...summaries.map(
      (s, i) =>
        `## 分塊 ${i + 1}：${s.title}\n${s.journal}\n\n未確認：\n${s.uncertainties.map((v) => `- ${v}`).join("\n")}`,
    ),
    "## 精確機器基準（不是區間新增收益）",
    plan.digest,
    `\n壓縮範圍：${plan.eventIds[0]}–${plan.through}，${plan.eventIds.length}筆事件。\n來源hash：${plan.sourceHash}\n歷史敘述不刷新角色狀態、護盾、費用或操作資格。`,
  ].join("\n\n");
  const receipt = records.append(key, {
    kind: "note",
    title: `帳本compaction ${plan.id.slice(0, 12)}`,
    body,
    characters,
    sources: [key],
  });
  if (records.read(receipt.id, receipt.revision).body !== body) {
    throw new Error("摘要落盤核驗失敗；不刪帳。");
  }
  return { reference: receipt.reference, usage };
}
export function compactLedger(
  runtime: LedgerRuntime,
  records: RecordsStore,
  model: RetentionModelCall,
  options: RetentionOptions = {},
) {
  return runtime.withMaintenance(async (signal) => {
    const plan = prepareRetention(runtime.store, options.minimumEvents);
    if (!plan) {
      return { state: "not_needed" as const, usage: [] };
    }
    const { reference, usage } = await saveSummary(
      records,
      plan,
      model,
      options,
      signal,
    );
    signal.throwIfAborted();
    // VACUUM備份在刪除交易之外，涵蓋WAL；commit後才移除暫存復原副本。
    const backup = runtime.store.backup();
    const checkpoint = commitRetention(runtime.store, plan, reference, signal);
    runtime.confirmRetention(checkpoint.id);
    let backupRetained = false;
    try {
      unlinkSync(backup);
    } catch {
      backupRetained = true;
    }
    return {
      state: "confirmed" as const,
      checkpoint: {
        id: checkpoint.id,
        from: checkpoint.from,
        through: checkpoint.through,
        deletedEvents: checkpoint.deletedEvents,
        summaryReference: checkpoint.summaryReference,
      },
      backupRetained,
      usage,
    };
  }, options.signal);
}
