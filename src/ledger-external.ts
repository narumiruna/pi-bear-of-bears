import type { LedgerEvent, LedgerOperation } from "./ledger-types.js";
import { WORKFLOW_QUERY } from "./workflow-parsers.js";

/** 非 ancestry 的遊戲事件不能被稍後的本機 metric 或舊 history 掩蓋。 */
export function externalLedgerBarriers(
  all: LedgerEvent[],
  included: Set<number>,
  observations: Set<number>,
  operation: (id: string) => LedgerOperation | undefined,
) {
  const lastState = new Map<string, unknown>();
  for (const event of all) {
    if (event.operationId && event.kind === "state") {
      lastState.set(event.operationId, event.data.state);
    }
  }
  const barriers = new Map<string, { id: number; at: number }>();
  for (const event of all) {
    if (included.has(event.id)) {
      continue;
    }
    const state =
      event.kind === "state" && event.operationId
        ? operation(event.operationId)
        : null;
    const potentialAction =
      state?.kind === "command" &&
      lastState.get(state.id) !== "not_dispatched" &&
      !WORKFLOW_QUERY.test(state.command ?? "");
    const unseenObservation =
      event.kind === "seen" &&
      !observations.has(Number(event.data.observationId));
    if (!potentialAction && !unseenObservation && event.kind !== "gap") {
      continue;
    }
    barriers.set(event.operationId ?? event.contextId, {
      id: event.id,
      at: event.at,
    });
  }
  return [...barriers.values()].sort((a, b) => a.id - b.id);
}
