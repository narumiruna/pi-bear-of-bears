import { recentCombatEvents } from "./combat-events.js";
import {
  BLOOD_SKILL,
  EARTH_SKILL,
  towerShieldBudget,
} from "./tower-shield-budget.js";
import type { WorkflowObservations } from "./workflow-observations.js";
import { towerFacts, WORKFLOW_QUERY } from "./workflow-parsers.js";
import { workflowResult } from "./workflow-result.js";

/** 只集中已選策略的資源判斷；不計未來回血、上界或執行操作。 */
export function planTowerStep(store: WorkflowObservations, snapshotId: string) {
  const result = workflowResult();
  const status = store.status();
  if (!status) {
    result.blockers.push("缺少新鮮、可綁定的本人資源；先補查 /status。");
    return result;
  }
  const point = store.assertCurrent(snapshotId, status.value.name, 60_000, [
    "status",
    "tower",
  ]);
  const tower = store.latest((message) => towerFacts(message.text));
  if (
    !tower ||
    !point.sources.some(
      (source) =>
        source.messageId === tower.source.messageId &&
        source.revision === tower.source.revision,
    )
  ) {
    result.blockers.push("快照缺少目前星塔的 message ID／revision 綁定。");
    return result;
  }
  result.actor = status.value.name;
  result.sources.push(status.source, tower.source);
  result.data.policy = "blood-earth-32-60";
  result.data.readOnly = true;
  result.data.riskVerified = false;
  result.data.warnings = [
    "這是條件式流程選擇，不是生存批准；成本、副作用、配裝、當層機制、血量階段及授權仍由 Agent 核對。",
    "不預借先機後吸血、閃避、暴追、星火或終殺；高血樣本不保證低血狂暴安全。",
    "只產生一項下一步，不施法、收刀、休息、退出、入塔或啟動背景工作。",
  ];
  const select = (
    decision: string,
    reason: string,
    recommendation: unknown = null,
  ) => {
    result.data.decision = decision;
    result.data.reason = reason;
    result.data.recommendation = recommendation;
    result.state = decision === "stop" ? "stopped" : "ready";
    return result;
  };
  if (
    status.value.idle ||
    status.value.hp === 0 ||
    status.value.estimated ||
    status.value.location !== "星塔前庭"
  ) {
    return select("stop", "本人仍在掛機、死亡、資源未結算或不在星塔前庭。");
  }
  if (
    !tower.value.challengeKnown ||
    tower.value.conflicts.length > 0 ||
    tower.value.floor === null ||
    !tower.value.target ||
    tower.value.hp === null ||
    tower.value.maxHp === null ||
    tower.value.hp <= 0
  ) {
    return select("stop", "沒有唯一且仍存活的目前挑戰；不自動跨層。");
  }
  const records = store.all();
  const lastChange = [...records]
    .reverse()
    .find(
      (record) =>
        record.message.outgoing && !WORKFLOW_QUERY.test(record.message.text),
    );
  if (
    lastChange &&
    /^\/(?:skill\s|attack(?:\s|$))/u.test(lastChange.message.text) &&
    !records.some(
      (record) =>
        !record.message.outgoing &&
        record.message.id > lastChange.message.id &&
        record.command === lastChange.message.text,
    )
  ) {
    result.blockers.push(
      "最後技能／攻擊缺少直接綁定回覆；先讀新 history，不重送。",
    );
    return result;
  }
  const combat = recentCombatEvents(store, result.actor);
  const recentSkill = records.find(
    (record) => record.source.messageId === combat?.source.messageId,
  );
  if (
    combat &&
    recentSkill?.command &&
    /^\/(?:skill\s|attack(?:\s|$))/u.test(recentSkill.command) &&
    !combat.complete &&
    (!lastChange || lastChange.message.id < recentSkill.message.id)
  ) {
    result.blockers.push(
      "最近戰鬥未完整解析；新 status 不能補證舊操作結果，先查原文／history。",
    );
    return result;
  }
  const shield = towerShieldBudget(
    records,
    result.actor,
    store.generation,
    tower.value,
  );
  result.data.shieldBudget = shield;
  result.sources.push(...shield.sources);
  result.data.resources = {
    hp: status.value.hp,
    maxHp: status.value.maxHp,
    mp: status.value.mp,
  };
  result.data.encounter = tower.value;
  if (shield.issues.length > 0) {
    result.blockers.push(...shield.issues);
    return result;
  }
  if (
    status.value.hp === status.value.maxHp &&
    shield.min !== null &&
    shield.min >= 2 &&
    status.value.mp >= 32
  ) {
    return select(
      "blood",
      "滿 HP、保守盾預算至少兩次且 MP ≥32；仍須獨立核當手先機與反擊風險。",
      { tool: "bears_skill", arguments: { name: BLOOD_SKILL } },
    );
  }
  if (status.value.mp < 92) {
    return select(
      "recover",
      "目前 MP 不足下一手：血怒需 32MP；需要刷新時須預留回春 60＋下一手血怒 32。92MP 不是所有攻擊門檻。",
      { tool: "bears_tower_recover", requiresFreshScope: true },
    );
  }
  return select(
    "spring",
    "HP 未滿或保守盾預算不足／未知；按已選策略先刷新，施放後重新觀測。",
    { tool: "bears_skill", arguments: { name: EARTH_SKILL } },
  );
}
