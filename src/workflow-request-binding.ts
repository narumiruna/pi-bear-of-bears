import type { GameMessage } from "./game.js";
import type { Observation } from "./workflow-observation-types.js";

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
