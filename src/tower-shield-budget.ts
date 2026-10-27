import { nativeSkillBinding, parseCombatEvents } from "./combat-events.js";
import type { Observation, Source } from "./workflow-observations.js";
import { cleanName, towerFacts, WORKFLOW_QUERY } from "./workflow-parsers.js";
import { knownQueryObservation } from "./workflow-query-observation.js";

export const BLOOD_SKILL = "血怒亂斬";
export const EARTH_SKILL = "地脈·萬物回春";
type Tower = NonNullable<ReturnType<typeof towerFacts>>;

/** 僅供條件規劃的保守預算，不改 parser 的 unknown 盾耗協定或 riskVerified。 */
export function towerShieldBudget(
  records: Observation[],
  actor: string,
  generation: number,
  tower: Tower,
  now = Date.now(),
) {
  const result = {
    min: null as number | null,
    reductionPercent: null as number | null,
    sources: [] as Source[],
    issues: [] as string[],
    assumptions: [
      "每個先機及反擊均按可能耗一次盾計，包含閃避；不以滿 HP 推定剩盾。",
      "只支援回春三次受擊減傷 24% 的原生回覆；不是實際剩盾或未來承傷證明。",
    ],
  };
  const isFresh = (record: Observation) =>
    record.actor === actor &&
    record.epoch === generation &&
    now >= record.source.observedAt &&
    now >= record.source.date * 1000 &&
    now - record.source.date * 1000 <= 60_000;
  const candidate = [...records]
    .reverse()
    .find(
      (record) =>
        isFresh(record) &&
        !record.message.outgoing &&
        record.command === `/skill ${EARTH_SKILL}`,
    );
  if (!candidate) {
    return result;
  }
  const request = records
    .slice(0, records.indexOf(candidate))
    .reverse()
    .find(
      (record) =>
        record.message.outgoing && !WORKFLOW_QUERY.test(record.message.text),
    );
  if (
    !request ||
    request.message.text !== `/skill ${EARTH_SKILL}` ||
    !isFresh(request)
  ) {
    result.issues.push("回春缺少在先、同角色／分支的 outgoing，不推盾耗。");
    return result;
  }
  const start = records.indexOf(request);
  // 無法由同名怪物反推樓層；回春前就必須有同層、同怪及上限來源。
  const anchor = records
    .slice(0, start)
    .reverse()
    .find(
      (record) =>
        isFresh(record) &&
        !record.message.outgoing &&
        towerFacts(record.message.text),
    );
  const original = anchor && towerFacts(anchor.message.text);
  if (
    !anchor ||
    !original ||
    original.floor !== tower.floor ||
    original.target !== tower.target ||
    original.maxHp !== tower.maxHp
  ) {
    return result;
  }
  result.sources.push(anchor.source, request.source);
  let enemyHp = original.hp;
  let pending: string | null = null;
  let replies = new Set<string>();
  for (const record of records.slice(start)) {
    if (
      !isFresh(record) ||
      record.revised ||
      records[start].coverage === undefined ||
      record.coverage !== records[start].coverage
    ) {
      result.issues.push(
        "盾來源區間有修訂、省略、過期、未歸屬或不同角色／分支的訊息。",
      );
      break;
    }
    const { message, command, source } = record;
    if (message.outgoing) {
      if (WORKFLOW_QUERY.test(message.text)) {
        continue;
      }
      if (pending) {
        result.issues.push("技能缺少直接綁定回覆，不延用盾。");
        break;
      }
      if (
        ![`/skill ${BLOOD_SKILL}`, `/skill ${EARTH_SKILL}`].includes(
          message.text,
        )
      ) {
        result.min = null;
        result.reductionPercent = null;
        // 收刀、休息、換裝或重新入塔後，不延用之前的盾。
        return result;
      }
      pending = message.text;
      replies = new Set();
      continue;
    }
    if (
      command &&
      WORKFLOW_QUERY.test(command) &&
      knownQueryObservation(message)
    ) {
      const current = towerFacts(message.text);
      if (
        current &&
        (current.floor !== tower.floor ||
          current.target !== tower.target ||
          current.maxHp !== tower.maxHp)
      ) {
        result.min = null;
        result.reductionPercent = null;
        return result;
      }
      if (current && current.hp !== enemyHp) {
        result.issues.push("怪血出現未由本區間回覆確認的變化，不延用盾。");
        break;
      }
      continue;
    }
    if (
      !command ||
      (pending !== null && pending !== command) ||
      replies.has(command)
    ) {
      result.issues.push("回覆歸屬缺漏、重複或互相矛盾，不推盾耗。");
      break;
    }
    const combat = parseCombatEvents(message.text, source);
    const binding = nativeSkillBinding(combat, command);
    const mp = combat.events.find((event) => event.kind === "mp_cost")?.nominal
      ?.value;
    if (
      !combat.complete ||
      !binding?.requestMatches ||
      mp !== (binding.name === EARTH_SKILL ? 60 : 32)
    ) {
      result.issues.push("技能回覆未完整解析或未直接綁定，不推盾耗。");
      break;
    }
    if (
      combat.target !== null &&
      cleanName(combat.target) !== cleanName(tower.target ?? "")
    ) {
      result.issues.push("技能回覆目標與目前挑戰不同。");
      break;
    }
    const enemyEvents = combat.events.filter((event) =>
      [
        "damage",
        "critical_followup",
        "reflection",
        "additional_damage",
      ].includes(event.kind),
    );
    if (enemyEvents.some((event) => event.maxHp?.value !== tower.maxHp)) {
      result.issues.push("戰報與塔況的怪血上限不同，不延用盾。");
      break;
    }
    if (enemyEvents.length > 0) {
      enemyHp = enemyEvents.at(-1)?.hpAfter?.value ?? null;
    }
    result.sources.push(source);
    pending = null;
    replies.add(command);
    if (binding.name === EARTH_SKILL) {
      const shields = combat.events.filter(
        (event) =>
          event.kind === "effect" &&
          /^🛡️ .+！接下來 3 次受擊減傷 24%$/u.test(event.description ?? ""),
      );
      if (
        shields.length !== 1 ||
        combat.events.some((event) =>
          ["initiative_marker", "counter"].includes(event.kind),
        )
      ) {
        result.issues.push("回春盾規格或事件順序不符合本策略，不補剩盾。");
        break;
      }
      result.min = 3;
      result.reductionPercent = 24;
    } else if (binding.name === BLOOD_SKILL && combat.outcome === "ongoing") {
      const hits = combat.events.filter((event) =>
        ["initiative_marker", "counter"].includes(event.kind),
      ).length;
      // 已支援的每手至多一個先機及一個反擊；其他事件組合保留未知。
      if (
        hits < 1 ||
        hits > 2 ||
        combat.events.filter((event) => event.kind === "counter").length !== 1
      ) {
        result.issues.push("受擊事件數不符合本策略，不推盾耗。");
        break;
      }
      result.min = result.min === null ? null : Math.max(0, result.min - hits);
    } else {
      result.min = null;
      result.reductionPercent = null;
      break;
    }
  }
  if (pending) {
    result.issues.push("最後技能仍缺直接綁定回覆；先讀新 history，不重送。");
  }
  if (result.min !== null && enemyHp !== tower.hp) {
    result.issues.push("最後怪血與快照不同，不延用盾。");
  }
  if (result.issues.length > 0) {
    result.min = null;
    result.reductionPercent = null;
  }
  return result;
}
