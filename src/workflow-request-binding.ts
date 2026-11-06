import { nativeSkillBinding, parseCombatEvents } from "./combat-events.js";
import type { GameMessage } from "./game.js";
import type { Observation, Source } from "./workflow-observation-types.js";
import { skillsFacts, statusFacts, towerFacts } from "./workflow-parsers.js";
import { knownQueryObservation } from "./workflow-query-observation.js";

export interface RequestBindingContext {
  request: string | undefined;
  actor: string | null;
  generation: number;
  coverage: number;
  requestActor: string | null;
  requestGeneration: number;
  pending: boolean;
}

/** 只標記同次指令已觀測的 outgoing；不補造結果或刷新來源。 */
export function markObservedRequest(
  record: Observation,
  context: RequestBindingContext,
) {
  if (
    !context.pending &&
    !record.revised &&
    record.message.outgoing &&
    context.request === record.message.text &&
    record.actor !== null &&
    record.actor === context.actor &&
    context.actor === context.requestActor &&
    record.epoch === context.generation &&
    context.generation === context.requestGeneration
  ) {
    record.requestObserved = true;
  }
}

export function updateRepeatedObservation(
  records: Iterable<Observation>,
  record: Observation,
  context: RequestBindingContext,
) {
  markObservedRequest(record, context);
  if (
    context.request &&
    canBindRepeatedObservation(
      records,
      record,
      context.request,
      context.actor,
      context.generation,
    )
  ) {
    record.command = context.request;
  }
}

/** 連續背包頁、完整技能與策略使用的唯讀面板，分別依來源規則承接。 */
export function observationRequest(
  records: Iterable<Observation>,
  message: GameMessage,
  source: Source,
  context: RequestBindingContext,
) {
  const prior = [...records];
  const continuationRequest =
    canBindLateReply(prior, message, source, context) ??
    (canBindInventoryContinuation(
      prior,
      message,
      context.actor,
      context.generation,
    )
      ? "/inventory all"
      : undefined);
  return {
    continuationRequest,
    command: message.outgoing
      ? message.text
      : (context.request ?? continuationRequest ?? null),
  };
}

/** 首次晚到的技能或 status／tower／skills，只承接同次 send 的真實 outgoing。 */
export function canBindLateReply(
  records: Iterable<Observation>,
  message: GameMessage,
  source: Source,
  context: RequestBindingContext,
) {
  if (
    message.outgoing ||
    context.actor === null ||
    context.pending ||
    context.request !== undefined
  ) {
    return;
  }
  let anchor: Observation | undefined;
  for (const record of records) {
    if (
      record.message.id < message.id &&
      (!anchor || record.message.id > anchor.message.id)
    ) {
      anchor = record;
    }
  }
  const age = anchor ? Date.now() - anchor.message.date * 1000 : -1;
  if (
    !anchor?.message.outgoing ||
    !anchor.requestObserved ||
    anchor.revised ||
    anchor.actor !== context.actor ||
    anchor.epoch !== context.generation ||
    anchor.coverage !== context.coverage ||
    age < 0 ||
    age > 60_000 ||
    anchor.source.observedAt > source.observedAt ||
    anchor.source.date > source.date ||
    source.date * 1000 > Date.now()
  ) {
    return;
  }
  if (anchor.message.text === "/status") {
    return statusFacts(message)?.name === context.actor &&
      knownQueryObservation(message) === true
      ? "/status"
      : undefined;
  }
  if (anchor.message.text === "/skills") {
    return skillsFacts(message.text) && knownQueryObservation(message) === true
      ? "/skills"
      : undefined;
  }
  if (anchor.message.text === "/tower") {
    const tower = towerFacts(message.text);
    return tower?.challengeKnown &&
      tower.conflicts.length === 0 &&
      tower.floor !== null &&
      tower.target !== null &&
      tower.hp !== null &&
      tower.maxHp !== null
      ? "/tower"
      : undefined;
  }
  if (!anchor.message.text.startsWith("/skill ")) {
    return;
  }
  const combat = parseCombatEvents(message.text, source);
  return combat.complete &&
    nativeSkillBinding(combat, anchor.message.text)?.requestMatches
    ? anchor.message.text
    : undefined;
}

/** 只承接同角色／epoch、緊鄰且未過期的已綁全列背包頁。 */
export function canBindInventoryContinuation(
  records: Iterable<Observation>,
  message: GameMessage,
  actor: string | null,
  generation: number,
) {
  let priorPage: Observation | undefined;
  for (const record of records) {
    if (
      record.message.id < message.id &&
      (!priorPage || record.message.id > priorPage.message.id)
    ) {
      priorPage = record;
    }
  }
  const pageAge = priorPage ? Date.now() - priorPage.message.date * 1000 : -1;
  return Boolean(
    priorPage?.command === "/inventory all" &&
      !priorPage.message.outgoing &&
      priorPage.message.id + 1 === message.id &&
      priorPage.actor === actor &&
      priorPage.epoch === generation &&
      pageAge >= 0 &&
      pageAge <= 60_000 &&
      /^\s*\d+\. /u.test(message.text),
  );
}

/** 同 ID／revision 不得重寫既有操作歸屬。
 * watch 先到的孤立回覆只可用當時已觀測、在先且同控制情境的 outgoing 補綁。
 * 新 request 不是送達或因果證明；不刷新來源時間，也不補造未知角色。
 */
export function canBindRepeatedObservation(
  records: Iterable<Observation>,
  record: Observation,
  request: string,
  actor: string | null,
  generation: number,
) {
  if (
    record.command !== null ||
    record.message.outgoing ||
    record.actor === null ||
    record.actor !== actor ||
    record.epoch !== generation
  ) {
    return false;
  }
  let anchor: Observation | undefined;
  for (const candidate of records) {
    if (
      candidate.message.outgoing &&
      candidate.message.id < record.message.id &&
      (!anchor || candidate.message.id > anchor.message.id)
    ) {
      anchor = candidate;
    }
  }
  return Boolean(
    anchor &&
      anchor.message.text === request &&
      anchor.actor === record.actor &&
      anchor.epoch === record.epoch &&
      anchor.source.date <= record.source.date &&
      anchor.source.observedAt <= record.source.observedAt,
  );
}
