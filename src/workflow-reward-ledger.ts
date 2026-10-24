import { parseCombatEvents } from "./combat-events.js";
import { idleReportFacts } from "./workflow-events.js";
import type { Checkpoint, Observation } from "./workflow-observation-types.js";

export interface RewardEvent {
  source: number;
  revision: string;
  category: string;
  credit: number;
  debit: number;
  format?: "labelled_replay";
}

export function rewardLedger(
  events: RewardEvent[],
  interval: Observation[],
  before: Checkpoint,
  after: Checkpoint,
  totals: {
    actualDelta: number | null;
    unexplained: number | null;
    blockers: string[];
  },
) {
  const { actualDelta, unexplained, blockers } = totals;
  const beforeId = before.id,
    afterId = after.id;
  return {
    character: after.actor,
    interval: {
      beforeId,
      afterId,
      fromMessageId: before.endId,
      throughMessageId: after.endId,
    },
    boundaries: {
      before: { status: before.status, sources: before.sources },
      after: { status: after.status, sources: after.sources },
    },
    confirmedTransactions: events.map((event) => {
      const record = interval.find(
        (record) => record.message.id === event.source,
      );
      const combat = record
        ? parseCombatEvents(record.message.text, record.source)
        : null;
      return {
        ...event,
        character: after.actor,
        source: record?.source ?? null,
        encounter: {
          type: "unknown",
          name: combat?.target ?? null,
          battleId: combat?.battleId ?? null,
        },
        classificationComplete: event.category !== "battle",
      };
    }),
    actualDelta,
    pendingAttribution: unexplained,
    evidenceMissing: [...blockers],
    note: "帳本只涵蓋此角色與已保存區間；戰利品來源類型未知時不按名稱猜野王或世界王。邊界不會停止原生或查詢。",
  };
}

export function idleRewardEvent(
  record: Observation,
  character: string,
): RewardEvent | null {
  if (record.command !== null && record.command !== "/stopidle") {
    return null;
  }
  const idle = idleReportFacts(record.message.text);
  if (
    !idle ||
    idle.character !== character ||
    (idle.settlementWindow === null && record.command !== "/stopidle")
  ) {
    return null;
  }
  return {
    source: record.message.id,
    revision: record.message.revision,
    category: record.command === "/stopidle" ? "idle_manual" : "idle_natural",
    credit: idle.gold,
    debit: 0,
  };
}
