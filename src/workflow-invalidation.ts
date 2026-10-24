import {
  type BarrierEvent,
  type Invalidator,
  OBSERVATION_CHANNELS,
  type Observation,
} from "./workflow-observation-types.js";
import { statusFacts } from "./workflow-parsers.js";

/** 最近 barrier 的歷史事件，不等於後續新觀測仍失效；不複製完整指令。 */
export function barrierEvent(
  invalidator: Invalidator | null,
  records: ReadonlyMap<number, Observation>,
): BarrierEvent | null {
  if (!invalidator) {
    return null;
  }
  const { kind, barrierId, messageId, revision, date } = invalidator;
  const source =
    messageId === undefined ? null : (records.get(messageId)?.source ?? null);
  return structuredClone({
    scope: "historical_barrier_event",
    kind,
    barrierId,
    messageId,
    revision,
    date,
    affectedBlocks: [...OBSERVATION_CHANNELS],
    source,
    sourceMissing: messageId !== undefined && source === null,
  });
}

/** 只回傳失效來源定位，不回填資格、角色或資源。 */
export function summarizeStatusInvalidation(
  invalidator: Invalidator | null,
  barrier: number,
  records: ReadonlyMap<number, Observation>,
) {
  const status = [...records.values()]
    .sort((a, b) => b.message.id - a.message.id)
    .find((record) => !record.message.outgoing && statusFacts(record.message));
  if (!status || status.message.id > barrier || !invalidator) {
    return null;
  }
  const source =
    invalidator.messageId === undefined
      ? undefined
      : records.get(invalidator.messageId)?.source;
  return structuredClone({
    statusSource: status.source,
    ...invalidator,
    affectedBlocks: [...OBSERVATION_CHANNELS],
    ...(source ? { source } : {}),
  });
}
