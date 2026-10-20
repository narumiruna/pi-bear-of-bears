import { recentCombatEvents } from "./combat-events.js";
import type { CombatObservation } from "./combat-planner.js";
import {
  type Checkpoint,
  cleanName,
  numberValue,
  roomFacts,
  type Source,
  skillsFacts,
  statusFacts,
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

function block(
  sources: Source[],
  dataPath: string,
  complete: boolean,
  uniquelyBound: boolean,
  maxAgeMs = 60_000,
) {
  return {
    dataPath,
    sources: structuredClone(sources),
    parsable: sources.length > 0,
    complete,
    fresh:
      sources.length > 0 &&
      sources.every(
        (source) =>
          Date.now() >= source.observedAt &&
          Date.now() >= source.date * 1000 &&
          Date.now() - source.date * 1000 <= maxAgeMs,
      ),
    uniquelyBound,
    riskVerified: false,
    maxAgeMs,
  };
}

function uniqueInventory(
  inventory: ReturnType<WorkflowObservations["inventory"]>,
) {
  const entries = inventory?.value.entries ?? [];
  return (
    Boolean(inventory?.value.complete) &&
    new Set(entries.map(({ id: _row, ...entry }) => JSON.stringify(entry)))
      .size === entries.length
  );
}

function skillActions(
  skills: ReturnType<typeof skillsFacts>,
  complete: boolean,
): CombatObservation["actions"] {
  if (!complete) {
    return [];
  }
  return (skills ?? []).flatMap((skill) =>
    skill.hpCost === null || skill.expectedDamage === null
      ? []
      : [
          {
            kind: "skill" as const,
            name: skill.name,
            available: skill.available,
            mpCost: skill.mpCost,
            hpCost: skill.hpCost,
            costsComplete: skill.costsComplete,
            expectedDamage: skill.expectedDamage,
          },
        ],
  );
}

function unparsedSkillLines(
  raw: string,
  skills: ReturnType<typeof skillsFacts>,
) {
  const described = new Set(
    (skills ?? []).flatMap((skill) =>
      skill.description.split("\n").map((line) => line.trim()),
    ),
  );
  return raw
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
}

function inventoryView(
  inventory: Checkpoint["inventory"],
  view: "full" | "summary",
) {
  if (!inventory || view === "full") {
    return inventory;
  }
  const equipped = inventory.entries.filter((entry) => entry.equipped);
  return {
    view: "summary",
    sourceTotal: inventory.total,
    acquiredRows: inventory.listed,
    sourceComplete: inventory.complete,
    diagnostics: inventory.diagnostics,
    filteredSubset: true,
    equipped,
    omittedRows: inventory.listed - equipped.length,
    actionable: false,
  };
}

export function combatSnapshot(
  store: WorkflowObservations,
  mode: "boss" | "tower",
  targetName?: string,
  existingId?: string,
  view: "full" | "summary" = "full",
) {
  const result = workflowResult();
  const status = store.status();
  if (!status) {
    // 只放寬診斷查閱的時效；仍保留目前角色、epoch、barrier 與可信時間檢查。
    const expired = store.latest(statusFacts, Number.POSITIVE_INFINITY);
    result.blockers.push(
      expired
        ? `本人 /status 原文已過期（訊息 ${expired.source.messageId}，距訊息時間 ${Date.now() - expired.source.date * 1000} ms；上限 60000 ms）；須取得新 /status 回覆。`
        : "缺少新鮮且可綁定的本人 /status 原文（可能尚未取得或來源已失效）。",
    );
    const invalidation = store.statusInvalidation();
    if (invalidation) {
      result.data.statusInvalidation = invalidation;
    }
    return result;
  }
  const recentCombat = recentCombatEvents(store, status.value.name);
  if (recentCombat && !recentCombat.complete) {
    result.blockers.push(
      "近期戰鬥事件缺漏或格式未知，不從未解析結果建立攻擊候選。",
    );
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
  const unparsedSkills = unparsedSkillLines(skillRaw, skills?.value);
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
  if (
    existingId &&
    sources.some(
      (source) =>
        !point.sources.some(
          (bound) =>
            bound.messageId === source.messageId &&
            bound.revision === source.revision,
        ),
    )
  ) {
    throw new Error("快照未綁定目前必要來源，須重新建立快照。");
  }
  result.actor = status.value.name;
  result.sources = point.sources;
  result.data = {
    snapshotId: point.id,
    nonAtomic: true,
    recentCombat,
    character: point.status,
    inventory: inventoryView(point.inventory, view),
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
  // 過期但仍可辨識的來源只用於缺漏診斷，不能回填可執行數值。
  const inventoryObserved = store.inventory(Number.POSITIVE_INFINITY);
  const skillsObserved =
    skills ??
    store.latest(
      (message) => skillsFacts(message.text),
      Number.POSITIVE_INFINITY,
    );
  const inventorySources = inventoryObserved?.sources ?? [];
  const inventoryUnique = uniqueInventory(inventoryObserved);
  const locationConsistent = Boolean(
    room && room.value.name === status.value.location,
  );
  if (room && !locationConsistent) {
    result.blockers.push("角色與現場位置來源互相矛盾，須重新觀測。");
  }
  const skillsComplete =
    Boolean(skills) &&
    unparsedSkills.length === 0 &&
    Boolean(
      skills?.value.every(
        (skill) =>
          skill.costsComplete &&
          skill.hpCost !== null &&
          skill.expectedDamage !== null,
      ),
    );
  result.data.blocks = {
    character: block([status.source], "character", true, true),
    equipment: block(
      inventorySources,
      view === "summary" ? "inventory.equipped" : "inventory.entries[equipped]",
      inventoryObserved?.value.complete ?? false,
      inventoryUnique,
      300_000,
    ),
    resources: block(
      [status.source],
      "character",
      status.value.gold !== null && !status.value.estimated,
      true,
    ),
    location: block(
      room ? [status.source, room.source] : [status.source],
      "room",
      locationConsistent,
      locationConsistent,
    ),
    encounter: block(
      mode === "tower"
        ? tower
          ? [tower.source]
          : []
        : room
          ? [room.source]
          : [],
      mode === "tower" ? "tower" : "room",
      Boolean(target),
      Boolean(target),
    ),
    skills: block(
      skillsObserved ? [skillsObserved.source] : [],
      "skills",
      skills ? skillsComplete : false,
      Boolean(skillsObserved),
    ),
    effects: block(
      runtime ? [runtime.source] : [],
      "effects",
      false,
      Boolean(runtime),
    ),
  };
  // 未知成本、傷害或未解析行不能產生可執行候選，不將未知數值補零。
  const actions = skillActions(
    skills?.value,
    skillsComplete && (!recentCombat || recentCombat.complete),
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
