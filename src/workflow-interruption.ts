import type { WorkflowResult } from "./workflow-result.js";

/** 中斷資訊不是可重送工作，也不延長最後來源的有效期。 */
export function workflowInterruption(
  result: WorkflowResult,
  target: unknown,
  detail: string,
  cancelled: boolean,
) {
  const pending = result.steps.filter(
    (step) => step.state === "outcome_unknown" || step.state === "submitted",
  );
  const last = result.steps.at(-1);
  const walked = result.data.walked;
  return {
    character: result.actor,
    target: target ?? null,
    confirmedMoves: Array.isArray(walked) ? walked.length : 0,
    lastConfirmedLocation: result.data.lastLocation ?? null,
    lastStatus: result.data.lastStatus ?? null,
    lastSource: result.sources.at(-1) ?? null,
    pending: pending.map((step) => ({ tool: step.tool, state: step.state })),
    lastStep: last ?? null,
    delivery:
      pending.length > 0
        ? "unknown"
        : last?.state === "rejected"
          ? "submitted"
          : last?.state === "not_dispatched"
            ? "not_dispatched"
            : "not_applicable",
    stopCode: /rate limit/iu.test(detail)
      ? "rate_limited"
      : cancelled
        ? "cancelled"
        : pending.length > 0
          ? "outcome_unknown"
          : last?.state === "rejected"
            ? "rejected"
            : "validation_stopped",
    revalidate: [
      "取得新觀測；核對目前角色、位置、資源、戰鬥／掛機狀態與操作授權。",
      "重驗來源 message ID／revision；未決操作先對帳，不重送。",
    ],
  };
}
