import { nativeSkillBinding, parseCombatEvents } from "./combat-events.js";
import { inventoryQuantities } from "./inventory-delta.js";
import { cooldownEvidence } from "./workflow-cooldown-evidence.js";
import { inventoryObservation } from "./workflow-inventory-observation.js";
import type { Observation, Source } from "./workflow-observation-types.js";
import type { WorkflowObservations } from "./workflow-observations.js";
import { skillsFacts, statusFacts, towerFacts } from "./workflow-parsers.js";

interface SkillsObservation {
  value: NonNullable<ReturnType<typeof skillsFacts>>;
  source: Source;
}
interface CurrentConditions {
  inventory?: ReturnType<typeof inventoryObservation>;
  skills?: SkillsObservation;
}

/** 比較最後觀測的欄位，不把列號當物品 ID，也不判斷效果等價或實戰提升。 */
function observedChanges<T extends { name: string }>(
  before: T[],
  after: T[],
  excluded: string[] = [],
) {
  const names = [...new Set([...before, ...after].map((item) => item.name))];
  const ambiguous = names.filter(
    (name) =>
      excluded.includes(name) ||
      before.filter((item) => item.name === name).length > 1 ||
      after.filter((item) => item.name === name).length > 1,
  );
  const added: T[] = [],
    removed: T[] = [];
  const changed: { name: string; before: T; after: T }[] = [];
  for (const name of names) {
    if (ambiguous.includes(name)) {
      continue;
    }
    const first = before.find((item) => item.name === name);
    const last = after.find((item) => item.name === name);
    if (!first && last) {
      added.push(last);
    } else if (first && !last) {
      removed.push(first);
    } else if (
      first &&
      last &&
      JSON.stringify(first) !== JSON.stringify(last)
    ) {
      changed.push({ name, before: first, after: last });
    }
  }
  return {
    added: added.slice(0, 20),
    removed: removed.slice(0, 20),
    changed: changed.slice(0, 20),
    ambiguousNames: ambiguous.slice(0, 20),
    omitted: {
      added: Math.max(0, added.length - 20),
      removed: Math.max(0, removed.length - 20),
      changed: Math.max(0, changed.length - 20),
      ambiguousNames: Math.max(0, ambiguous.length - 20),
    },
  };
}

function conditionComparison(
  inventory: ReturnType<typeof inventoryObservation>,
  skills: SkillsObservation | null,
  current: CurrentConditions,
) {
  const equipment =
    inventory?.value.complete && current.inventory?.value.complete
      ? {
          historicalSources: inventory.sources,
          currentSources: current.inventory.sources,
          ...observedChanges(
            inventory.value.entries
              .filter((item) => item.equipped)
              .map(({ id: _id, ...item }) => item),
            current.inventory.value.entries
              .filter((item) => item.equipped)
              .map(({ id: _id, ...item }) => item),
            [
              ...inventoryQuantities(inventory.value.entries).ambiguous,
              ...inventoryQuantities(current.inventory.value.entries).ambiguous,
            ],
          ),
        }
      : null;
  const skillChanges =
    skills && current.skills
      ? {
          historicalSources: [skills.source],
          currentSources: [current.skills.source],
          ...observedChanges(skills.value, current.skills.value),
          coverage: "parsed_entries_only",
        }
      : null;
  return {
    basis: "last_observations_only",
    equipment,
    skills: skillChanges,
    missingBlocks: [
      !equipment ? "equipment" : null,
      !skillChanges ? "skills" : null,
    ].filter((block) => block !== null),
    conditionsComplete: false,
    note: "只比較完整背包的穿戴欄位與已解析技能列；缺資料保持未知。最後觀測不是戰鬥當下快照，欄位相同不證明條件相同，差異不代表提升或勝率。",
  };
}

/** 只整理目前分支保存的正式回執；型別或條件缺證時保持 unknown。 */
export function combatHistory(
  records: Observation[],
  current?: ReturnType<WorkflowObservations["status"]>,
  currentConditions: CurrentConditions = {},
) {
  const samples = [];
  const incomplete = [];
  for (const record of records) {
    if (record.message.outgoing) {
      continue;
    }
    if (
      !record.actor ||
      !/^\/(?:attack|skill|flee|tower)(?:\s|$)/u.test(record.command ?? "")
    ) {
      if (/^(?:戰鬥紀錄：|✨ 使用技能：)/u.test(record.message.text)) {
        incomplete.push(record.source);
      }
      continue;
    }
    const combat = parseCombatEvents(record.message.text, record.source);
    const skill = nativeSkillBinding(combat, record.command);
    if (
      !combat.complete ||
      skill?.requestMatches === false ||
      !["won", "escaped", "lost"].includes(combat.outcome)
    ) {
      if (/^(?:戰鬥紀錄：|✨ 使用技能：)/u.test(record.message.text)) {
        incomplete.push(record.source);
      }
      continue;
    }
    const prior = records.filter(
      (candidate) =>
        !candidate.message.outgoing &&
        candidate.actor === record.actor &&
        candidate.epoch === record.epoch &&
        candidate.message.id < record.message.id &&
        candidate.source.observedAt <= record.source.observedAt &&
        candidate.source.date <= record.source.date,
    );
    const latest = <T>(parse: (record: Observation) => T | undefined) => {
      for (const candidate of [...prior].reverse()) {
        const value = parse(candidate);
        if (value !== undefined) {
          return { value, source: candidate.source };
        }
      }
      return null;
    };
    const status = latest((entry) => statusFacts(entry.message));
    const inventory = inventoryObservation(prior, Number.POSITIVE_INFINITY);
    const skills = latest((entry) => skillsFacts(entry.message.text));
    const tower = latest((entry) => towerFacts(entry.message.text));
    const comparable =
      status && current && status.value.name === current.value.name;
    const differences = comparable
      ? Object.entries({
          hp: [status.value.hp, current.value.hp],
          mp: [status.value.mp, current.value.mp],
          gold: [status.value.gold, current.value.gold],
          ...Object.fromEntries(
            Object.keys(status.value.attributes).map((key) => [
              key,
              [status.value.attributes[key], current.value.attributes[key]],
            ]),
          ),
        }).map(([field, [before, after]]) => ({
          field,
          before,
          after,
          delta:
            typeof before === "number" && typeof after === "number"
              ? after - before
              : null,
        }))
      : null;
    samples.push({
      character: record.actor,
      source: record.source,
      target: { name: combat.target, type: "unknown" },
      lastObservedTower: tower,
      outcome: combat.outcome,
      battleId: combat.battleId,
      observedSkill: skill?.requestMatches
        ? { name: skill.name, source: record.source }
        : null,
      lastObservedResources: status,
      lastObservedComparison: comparable
        ? {
            historicalSource: status.source,
            currentSource: current.source,
            differences,
            basis: "last_observations_only",
          }
        : null,
      lastObservedConditionComparison: comparable
        ? conditionComparison(inventory, skills, currentConditions)
        : null,
      lastObservedEquipment: inventory?.value.complete
        ? {
            equipped: inventory.value.entries.filter((entry) => entry.equipped),
            sources: inventory.sources,
          }
        : null,
      skills,
      events: combat.events,
      riskVerified: false,
      conditionsComplete: false,
      unknowns: [
        "回執前狀態不是原子快照；未知裝備變更、遭遇階段及來源型別不可補值。",
        "完整背包保留各頁來源；若缺頁、重編號或未核配裝變動則條件未知。樣本不是承傷上界或下一階許可。",
      ],
    });
  }
  return {
    samples: samples.slice(-20),
    omittedSamples: Math.max(0, samples.length - 20),
    incompleteSources: incomplete.slice(-20),
    omittedIncompleteSources: Math.max(0, incomplete.length - 20),
    personalCooldown: cooldownEvidence(
      records,
      samples.filter((sample) => sample.outcome === "won"),
      incomplete,
    ),
    actionable: false,
  };
}
