import type { CombatObservation } from "./combat-planner.js";
import {
  cleanName,
  numberValue,
  roomFacts,
  type Source,
  skillsFacts,
  towerFacts,
  type WorkflowObservations,
} from "./workflow-observations.js";
import { workflowResult } from "./workflow-result.js";

function plannerSource(source: Source | undefined) {
  return source
    ? {
        messageId: source.messageId,
        revision: source.revision,
        date: source.date,
      }
    : undefined;
}

export function combatSnapshot(
  store: WorkflowObservations,
  mode: "boss" | "tower",
  targetName?: string,
  existingId?: string,
) {
  const result = workflowResult();
  const status = store.status();
  if (!status) {
    result.blockers.push("缺少本人新 /status 原文。");
    return result;
  }
  const tower = store.latest((message) => towerFacts(message.text));
  const room = store.latest((message) => roomFacts(message.text));
  const skills = store.latest((message) => skillsFacts(message.text));
  const skillRaw = skills
    ? (store
        .all()
        .find((record) => record.message.id === skills.source.messageId)
        ?.message.text ?? "")
    : "";
  const described = new Set(
    (skills?.value ?? []).flatMap((skill) =>
      skill.description.split("\n").map((line) => line.trim()),
    ),
  );
  const unparsedSkills = skillRaw
    .split("\n")
    .map((line) => line.trim())
    .filter(
      (line) =>
        line &&
        !described.has(line) &&
        !/^(?:(?:技能(?:列表|一覽)?|可用技能|[─━=-]+)\s*$|(?:目前)?MP[：:]|✨\s+[\p{L}\p{N}·_]+\s+技能[（(]MP[：:]\s*\d+\/\d+[）)]$|普攻期望\s+[\d,]+\s+對(?:\s+.+|無防禦目標)；技能數字＝一次施放期望，不含爆擊／被動$|🎁\s*裝備技能[：:]$)/u.test(
          line,
        ),
    );
  const runtime = store.runtimeEffects();
  const sources = [
    ...(runtime ? [runtime.source] : []),
    ...(tower ? [tower.source] : []),
    ...(room ? [room.source] : []),
    ...(skills ? [skills.source] : []),
  ];
  const point = existingId
    ? store.assertCurrent(existingId, status.value.name)
    : store.capture(sources);
  result.actor = status.value.name;
  result.sources = point.sources;
  result.data = {
    snapshotId: point.id,
    character: point.status,
    inventory: point.inventory,
    home: point.home,
    room: room?.value ?? null,
    skills: skills?.value ?? null,
    unparsedSkills,
    effects: {
      runtime: runtime?.effects ?? [],
      unknown: [
        "護盾耗次、DOT、易傷與完整特殊機制須核對；不從技能文案推 runtime。",
      ],
    },
  };
  if (status.value.idle || status.value.hp === 0) {
    result.blockers.push("角色仍在掛機或 HP 為 0。");
  }
  let target:
    | { name: string; hp: number; present: boolean; floor?: number }
    | undefined;
  if (mode === "tower") {
    const value = tower?.value;
    if (
      value?.floor !== null &&
      value?.floor !== undefined &&
      value.target &&
      value.hp !== null
    ) {
      if (targetName && targetName !== value.target) {
        result.blockers.push("指定目標與目前塔怪不同。");
      } else {
        target = {
          name: value.target,
          hp: value.hp,
          present: true,
          floor: value.floor,
        };
      }
    }
    result.data.tower = value ?? null;
  } else if (targetName && room) {
    const raw =
      store.all().find((record) => record.message.id === room.source.messageId)
        ?.message.text ?? "";
    const matches = raw.split("\n").flatMap((line) => {
      const match =
        /^(?:[^\p{L}\p{N}]*)(.+?)\s+(?:Lv\d+\s+)?HP[：:]\s*([\d,]+)\/([\d,]+)/u.exec(
          line,
        ) ??
        /^\s*\[[1-9]\d*\]\s+[^\p{L}\p{N}]*(.+?)\s+Lv\d+\s+\[[█░]+\]\s*([\d,]+)\/([\d,]+)\s*$/u.exec(
          line,
        );
      if (!match || cleanName(match[1]) !== targetName) {
        return [];
      }
      const hp = numberValue(match[2]),
        maxHp = numberValue(match[3]);
      return hp !== null && maxHp !== null && maxHp > 0 && hp <= maxHp
        ? [{ name: targetName, hp, present: true }]
        : [];
    });
    if (matches.length === 1) {
      target = matches[0];
    } else if (matches.length > 1) {
      result.blockers.push("同名目標無法唯一識別。");
    }
  }
  if (!target) {
    result.blockers.push("缺少可唯一綁定的目標現身、HP 或樓層。");
  }
  if (!skills) {
    result.blockers.push("缺少新鮮且可解析的本人技能原文。");
  }
  if (
    skills?.value.some(
      (skill) => !skill.costsComplete || skill.expectedDamage === null,
    )
  ) {
    result.blockers.push("技能完整成本或傷害未知，不補成已確認零值。");
  }
  if (unparsedSkills.length > 0) {
    result.blockers.push("技能原文有未解析行，不宣稱技能資料完整。");
  }
  const actions: CombatObservation["actions"] = (skills?.value ?? []).map(
    (skill) => ({
      kind: "skill",
      name: skill.name,
      available: skill.available,
      mpCost: skill.mpCost,
      hpCost: skill.hpCost ?? 0,
      costsComplete: skill.costsComplete,
      expectedDamage: skill.expectedDamage ?? 0,
    }),
  );
  if (target) {
    const observation: CombatObservation = {
      mode,
      character: {
        name: status.value.name,
        hp: status.value.hp,
        maxHp: status.value.maxHp,
        mp: status.value.mp,
        idle: status.value.idle,
      },
      target,
      lastOutcome: "confirmed",
      rateLimited: false,
      evidence: {
        status: plannerSource(status.source),
        target: plannerSource(mode === "tower" ? tower?.source : room?.source),
        actions: plannerSource(skills?.source),
      },
      actions,
    };
    result.data.plannerObservation = observation;
  }
  result.data.riskVerified = false;
  result.next.push("承傷上界仍須依完整機制另行核對；本快照不授權或建議攻擊。");
  if (result.blockers.length === 0) {
    result.state = "ready";
  }
  return result;
}
