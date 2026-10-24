import { nativeForgeFacts } from "./upgrade-native.js";
import type { workflowInterruption } from "./workflow-interruption.js";
import type {
  BarrierEvent,
  Invalidator,
  Observation,
  Source,
} from "./workflow-observation-types.js";
import { statusFacts } from "./workflow-parsers.js";
import type { WorkflowResult } from "./workflow-result.js";

export interface PendingWorkflow {
  character: string | null;
  generation: number;
  steps: WorkflowResult["steps"];
  sources: Source[];
  interruption: ReturnType<typeof workflowInterruption> | null;
}

/** 有界未決回報；唯讀成功不代表先前未知操作已對帳。 */
export class ContinuationReports {
  private reports: PendingWorkflow[] = [];
  private omittedReports = 0;
  reset() {
    this.reports = [];
    this.omittedReports = 0;
  }
  remember(result: WorkflowResult, generation: number) {
    const steps = result.steps.filter(
      (step) => step.state === "outcome_unknown" || step.state === "submitted",
    );
    if (steps.length === 0) {
      return;
    }
    if (this.reports.length < 20) {
      this.reports.push(
        structuredClone({
          character: result.actor,
          generation,
          steps,
          sources: result.sources,
          interruption:
            (result.data.interruption as PendingWorkflow["interruption"]) ??
            null,
        }),
      );
    } else {
      this.omittedReports++;
    }
  }
  snapshot() {
    return structuredClone({
      reports: this.reports,
      omittedReports: this.omittedReports,
    });
  }
}

interface ContinuationContext {
  controlIdentityKnown: boolean;
  invalidationEvent: BarrierEvent | null;
  pendingWorkflows: { reports: PendingWorkflow[]; omittedReports: number };
  statusInvalidation:
    | (Invalidator & {
        statusSource: Source;
        affectedBlocks: string[];
        source?: Source;
      })
    | null;
  observationCoverage: {
    omittedBatches: number;
    evictedMessages: number;
    savedMessages: number;
  };
}

/** 只核對原參照是否仍在；匹配不表示新鮮或取得操作資格。 */
function validatePendingSources(
  report: PendingWorkflow,
  records: Map<number, Observation>,
) {
  const issues: { source: Source | null; reason: string }[] = [];
  if (report.sources.length === 0) {
    issues.push({ source: null, reason: "missing_source_list" });
  }
  for (const source of report.sources) {
    const current = records.get(source.messageId);
    const reason = !current
      ? "source_missing"
      : current.message.revision !== source.revision
        ? "revision_changed"
        : current.source.date !== source.date ||
            current.source.observedAt !== source.observedAt
          ? "source_time_changed"
          : current.epoch !== report.generation
            ? "generation_changed"
            : report.character === null || current.actor !== report.character
              ? "actor_unbound"
              : current.message.outgoing
                ? "outgoing_source"
                : null;
    if (reason) {
      issues.push({ source, reason });
    }
  }
  return {
    allReferencesMatch: issues.length === 0,
    checkedSources: report.sources.length,
    issues: issues.slice(0, 20),
    omittedIssues: Math.max(0, issues.length - 20),
  };
}

/** 純本機歷史摘要，不重建可信執行資格或持久化待送工作。 */
export function buildContinuation(
  records: Observation[],
  actor: string | null,
  generation: number,
  statusFresh: boolean,
  context: ContinuationContext,
) {
  const own = records.filter(
    (record) =>
      !record.message.outgoing &&
      record.actor === actor &&
      record.epoch === generation,
  );
  const statusRecord = [...own]
    .reverse()
    .find((record) => statusFacts(record.message));
  const lastStatus = statusRecord
    ? (statusFacts(statusRecord.message) ?? null)
    : null;
  const receipt = [...own]
    .reverse()
    .find(
      (record) =>
        record.message.text.startsWith("🔨✨ 進階成功！") &&
        (nativeForgeFacts(record.message.text)?.receiptTotalGold ?? null) !==
          null,
    );
  const relatedRequests = records
    .filter(
      (record) =>
        record.actor === actor &&
        record.epoch === generation &&
        record.message.outgoing &&
        /^\/(?:dismantle|forge|refine|craft)\s/u.test(record.message.text),
    )
    .slice(-5)
    .map((record) => ({
      source: record.source,
      commandCategory: record.message.text.split(/\s/u, 1)[0],
      confirmation: "request_only_may_include_preview",
    }));
  const lastRequest = relatedRequests.at(-1);
  const receiptObservation = receipt
    ? {
        kind: "parsed_receipt" as const,
        source: receipt.source,
        receipt: nativeForgeFacts(receipt.message.text),
      }
    : null;
  const lastIrreversibleObservation =
    lastRequest &&
    (!receipt || lastRequest.source.messageId > receipt.message.id)
      ? { kind: "unverified_request" as const, ...lastRequest }
      : receiptObservation;
  const indexed = new Map(records.map((record) => [record.message.id, record]));
  const pendingWorkflows = {
    ...context.pendingWorkflows,
    reports: context.pendingWorkflows.reports.map((report) => ({
      ...report,
      sameControlContext:
        context.controlIdentityKnown &&
        report.character === actor &&
        report.generation === generation,
      sourceValidation: validatePendingSources(report, indexed),
    })),
  };
  return structuredClone({
    generation,
    controlIdentityKnown: context.controlIdentityKnown,
    controlledCharacter:
      statusFresh && context.controlIdentityKnown
        ? (lastStatus?.name ?? null)
        : null,
    lastObservedCharacter: lastStatus?.name ?? null,
    lastStatus,
    statusSource: statusRecord?.source ?? null,
    statusFresh,
    nativeIdle: statusFresh ? (lastStatus?.idle ?? null) : null,
    lastObservedNativeIdle: lastStatus?.idle ?? null,
    pendingWorkflows,
    statusInvalidation: context.statusInvalidation,
    invalidationEvent: context.invalidationEvent,
    observationCoverage: context.observationCoverage,
    lastIrreversibleObservation,
    irreversibleReceiptCoverage: "forge_receipts_only",
    recentRelatedRequests: relatedRequests,
    lastIrreversibleReceipt: receipt
      ? {
          source: receipt.source,
          receipt: nativeForgeFacts(receipt.message.text),
        }
      : null,
    actionable: false,
    note: "歷史檢查點不是即時狀態、授權或 resume 工作；新觀測與授權核驗仍必要。未決回報不因新查詢成功自動解決。",
  });
}
