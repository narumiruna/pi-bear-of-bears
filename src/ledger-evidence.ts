import { ledgerBindings } from "./ledger-attribution.js";
import {
  fingerprint,
  type LedgerCombat,
  type LedgerStatus,
  ledgerFact,
} from "./ledger-facts.js";
import { ledgerSource, projectLedger } from "./ledger-projection.js";
import type { LedgerData } from "./ledger-types.js";
import {
  compareCombatConditions,
  type ObservedCombatConditions,
} from "./workflow-combat-history.js";

export function ledgerEvidence(
  data: LedgerData,
  character?: string,
  afterObservationId = 0,
) {
  const selected = ledgerBindings(data),
    projection = projectLedger(data, character);
  const ownership = new Map(
    projection.operations.map((o) => [o.id, o.character]),
  );
  const replies = new Map(
    selected.bindings.filter((b) => b.reply).map((b) => [b.reply?.id, b]),
  );
  let actor: string | null = null,
    equipment: string | null = null,
    skills: string | null = null;
  let floor: number | null = null,
    target: string | null = null,
    hp: number | null = null,
    maxHp: number | null = null;
  let previous: ObservedCombatConditions | null = null;
  const maxima = new Map<string, number>();
  const samples = [];
  for (const obs of selected.observations) {
    const facts = selected.facts.get(obs.id) ?? [];
    const status = ledgerFact<LedgerStatus>(facts, "status");
    if (status) {
      if (actor !== status.name) {
        equipment = null;
        skills = null;
        floor = null;
        target = null;
        hp = null;
        maxHp = null;
        previous = null;
      }
      actor = status.name;
    }
    if (obs.message.outgoing) {
      if (
        /^\/(?:char|equip|forge|refine|craft)(?:\s|$)/u.test(obs.message.text)
      ) {
        equipment = null;
        hp = null;
        maxHp = null;
      }
      if (/^\/(?:char|learn|evolve)(?:\s|$)/u.test(obs.message.text)) {
        skills = null;
      }
      if (/^\/(?:char|tower (?:go|quit))(?:\s|$)/u.test(obs.message.text)) {
        floor = null;
        target = null;
        hp = null;
        maxHp = null;
      }
      continue;
    }
    const gear = ledgerFact<{ version: string }>(facts, "equipment"),
      skill = ledgerFact<{ version: string }>(facts, "skills");
    if (gear) {
      equipment = gear.version;
    }
    if (skill) {
      skills = skill.version;
    }
    const tower = ledgerFact<{
      floor: number | null;
      target: string | null;
      hp: number | null;
      maxHp: number | null;
    }>(facts, "tower");
    if (tower) {
      floor = tower.floor;
      target = tower.target;
      hp = tower.hp;
      maxHp = tower.maxHp;
    }
    const combat = ledgerFact<LedgerCombat>(facts, "combat"),
      binding = replies.get(obs.id);
    if (!combat || !binding) {
      continue;
    }
    const owner = ownership.get(binding.operation.id) ?? null;
    const phase =
      hp !== null && maxHp !== null && maxHp > 0
        ? hp / maxHp > 0.5
          ? "above_half"
          : hp / maxHp > 0.4
            ? "half_to_40_percent"
            : "at_or_below_40_percent"
        : null;
    const conditions: ObservedCombatConditions = {
      character: owner,
      equipmentVersion: equipment,
      skillsVersion: skills,
      floor: combat.target === target ? floor : null,
      target: combat.target,
      phase,
      protectionPolicy: null,
    };
    const comparison = compareCombatConditions(previous, conditions);
    // 缺條件的樣本不互相合併，政策未知不當成相同防護。
    const group = fingerprint(
      comparison.missing.length === 0
        ? conditions
        : { conditions, observationId: obs.id },
    );
    const incoming = combat.events
      .filter((e) => ["initiative", "counter", "hp_cost"].includes(e.kind))
      .flatMap((e) =>
        typeof e.actual?.value === "number" ? [e.actual.value] : [],
      );
    const highest = incoming.length > 0 ? Math.max(...incoming) : null;
    const prior = maxima.get(group);
    const counterexample =
      comparison.missing.length === 0 && highest !== null && prior !== undefined
        ? highest > prior
        : null;
    if (highest !== null) {
      maxima.set(group, Math.max(prior ?? 0, highest));
    }
    if ((!character || owner === character) && obs.id > afterObservationId) {
      samples.push({
        source: ledgerSource(obs),
        operationId: binding.operation.id,
        group,
        conditions,
        changedSincePrevious: comparison.changed,
        missingConditions: comparison.missing,
        complete: combat.complete,
        order: combat.events,
        unknownLines: combat.unknownLines,
        issues: combat.issues,
        observedMaxIncoming: highest,
        counterexample,
        riskVerified: false,
        conditionsComplete: false,
        protection: {
          remainingHits: null,
          conservativePolicy: null,
          note: "遊戲耗次與 Agent 保守政策均未確認；舊盾不可作資格。",
        },
      });
    }
    previous = conditions;
    const enemy = combat.events
      .filter((e) =>
        [
          "damage",
          "critical_followup",
          "additional_damage",
          "reflection",
        ].includes(e.kind),
      )
      .at(-1);
    hp = enemy?.hpAfter?.value ?? null;
    maxHp = enemy?.maxHp?.value ?? null;
    if (!combat.complete || ledgerFact(facts, "tower_clear")) {
      hp = null;
      maxHp = null;
    }
  }
  return {
    samples,
    conflicts: selected.conflicts,
    riskVerified: false,
    actionable: false,
    note: "條件僅為最後觀測；血量分組不是已知狂暴門檻，樣本不是理論上界。未知防護政策不合併為可比較樣本。",
  };
}
