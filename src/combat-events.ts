import { parseNativeCombat } from "./combat-native.js";
import type { Source, WorkflowObservations } from "./workflow-observations.js";
import { numberValue } from "./workflow-parsers.js";

export interface Fact {
  value: number | null;
  basis: "observed" | "derived" | "unknown";
}
export interface CombatEvent {
  line: number;
  kind: string;
  nominal?: Fact;
  actual?: Fact;
  hpAfter?: Fact;
  maxHp?: Fact;
  description?: string;
}
const fact = (
  value: number | null,
  basis: Fact["basis"] = "observed",
): Fact => ({ value, basis: value === null ? "unknown" : basis });
type Outcome = "ongoing" | "won" | "lost" | "escaped" | "unknown";

/** 原生已觀察技能回覆與標籤式 replay 分流；不套推測性規則或提供攻擊授權。 */
export function parseCombatEvents(text: string, source: Source) {
  if (text.startsWith("✨ 使用技能：")) {
    return parseNativeCombat(text, source);
  }
  const lines = text.split("\n");
  const heading = /^戰鬥紀錄：(.+)$/u.exec(lines[0]);
  const events: CombatEvent[] = [],
    issues: string[] = [],
    unknownLines: { line: number; text: string }[] = [];
  let outcome: Outcome = "unknown",
    formal: Outcome | null = null,
    gold: number | null = null;
  let playerHp: number | null = null,
    playerMax: number | null = null,
    enemyHp: number | null = null,
    enemyMax: number | null = null;
  let shield: {
    remainingHits: null;
    bounds: { min: number; max: number };
    basis: string;
    assumptions: string[];
  } | null = null;
  const transition = (line: string, event: CombatEvent, enemy: boolean) => {
    const pattern = enemy
      ? /；敵HP：([\d,]+)→([\d,]+)\/([\d,]+)$/u
      : /；HP：([\d,]+)→([\d,]+)\/([\d,]+)$/u;
    const match = pattern.exec(line);
    const before = numberValue(match?.[1]),
      after = numberValue(match?.[2]),
      max = numberValue(match?.[3]);
    const previous = enemy ? enemyHp : playerHp;
    if (
      before === null ||
      after === null ||
      max === null ||
      max <= 0 ||
      before > max ||
      after > max ||
      (previous !== null && previous !== before) ||
      (enemy
        ? enemyMax !== null && enemyMax !== max
        : playerMax !== null && playerMax !== max)
    ) {
      issues.push(`第${event.line}行 HP 缺段、矛盾或無效。`);
      event.actual = fact(null);
      return;
    }
    const change = event.kind === "healing" ? after - before : before - after;
    const nominal = event.nominal?.value;
    if (
      change < 0 ||
      nominal === null ||
      nominal === undefined ||
      change > nominal
    ) {
      issues.push(`第${event.line}行名義數值與 HP 變化矛盾。`);
      event.actual = fact(null);
    } else {
      event.actual = fact(change, "derived");
    }
    if (enemy) {
      enemyHp = after;
      enemyMax = max;
    } else {
      playerHp = after;
      playerMax = max;
    }
  };
  if (heading) {
    for (let index = 1; index < lines.length; index++) {
      const line = lines[index].trim();
      if (!line) {
        continue;
      }
      const position = index + 1;
      if (formal !== null && !/^獲得金幣：/u.test(line)) {
        issues.push(`第${position}行在正式結算後仍有戰鬥事件。`);
      }
      const cost = /^MP消耗：([\d,]+)$/u.exec(line);
      const change =
        /^(先機|反擊|燃血|恢復|對敵傷害)：([\d,]+)(?:（閃避）)?(?:；(?:敵HP|HP)：[\d,]+→[\d,]+\/[\d,]+)?$/u.exec(
          line,
        );
      if (cost) {
        const value = numberValue(cost[1]);
        if (value === null) {
          issues.push(`第${position}行成本無效。`);
        }
        events.push({ line: position, kind: "mp_cost", nominal: fact(value) });
        continue;
      }
      if (change) {
        const kind = (
          {
            先機: "initiative",
            反擊: "counter",
            燃血: "hp_cost",
            恢復: "healing",
            對敵傷害: "damage",
          } as Record<string, string>
        )[change[1]];
        const event: CombatEvent = {
          line: position,
          kind,
          nominal: fact(numberValue(change[2])),
        };
        transition(line, event, kind === "damage");
        events.push(event);
        continue;
      }
      const effect = /^護盾：接下來([\d,]+)次受擊減傷(\d+)%$/u.exec(line);
      if (
        effect &&
        numberValue(effect[1]) !== null &&
        numberValue(effect[2]) !== null &&
        Number(effect[2]) <= 100
      ) {
        shield = {
          remainingHits: null,
          bounds: { min: 0, max: Number(effect[1]) },
          basis: "derived",
          assumptions: ["未取得耗次協定；閃避是否耗次未知，不作生存預算。"],
        };
        events.push({
          line: position,
          kind: "effect",
          description: line,
          nominal: fact(Number(effect[2])),
        });
        continue;
      }
      if (/^效果：.+$/u.test(line)) {
        events.push({ line: position, kind: "effect", description: line });
        continue;
      }
      const settlement = /^結算：(勝利|失敗|逃離)$/u.exec(line);
      if (settlement) {
        const next = ({ 勝利: "won", 失敗: "lost", 逃離: "escaped" } as const)[
          settlement[1] as "勝利" | "失敗" | "逃離"
        ];
        if (formal !== null) {
          issues.push("正式結算重複或互相矛盾。");
        }
        formal = next;
        outcome = next;
        events.push({ line: position, kind: "settlement", description: next });
        continue;
      }
      if (line === "狀態：戰鬥中") {
        if (formal) {
          issues.push("正式結算之後仍標示戰鬥中。");
        }
        outcome = "ongoing";
        events.push({ line: position, kind: "state", description: "ongoing" });
        continue;
      }
      const reward = /^獲得金幣：([\d,]+)G$/u.exec(line);
      if (reward) {
        const value = numberValue(reward[1]);
        if (formal !== "won") {
          issues.push("金幣回執缺少在前的正式勝利結算。");
        }
        if (gold !== null || value === null) {
          issues.push("金幣回執重複或無效。");
        }
        gold = value;
        events.push({ line: position, kind: "reward", nominal: fact(value) });
        continue;
      }
      unknownLines.push({ line: position, text: line });
    }
  } else {
    unknownLines.push(
      ...lines.map((line, index) => ({ line: index + 1, text: line })),
    );
  }
  if (unknownLines.length > 0) {
    issues.push("有未確認事件格式，不從剩餘 HP 分攤多次治療或猜測傷害。");
  }
  if (events.length === 0) {
    issues.push("沒有完整可解析的戰鬥事件。");
  }
  if (formal === "won" && enemyHp !== null && enemyHp !== 0) {
    issues.push("正式勝利與最後敵 HP 矛盾。");
  }
  const complete = Boolean(heading) && issues.length === 0;
  return {
    format: heading ? "labelled_replay" : "unsupported",
    target: heading?.[1] ?? null,
    battleId: null,
    source: structuredClone(source),
    events,
    complete,
    outcome: complete ? outcome : "unknown",
    rewardGold: fact(complete && formal === "won" ? gold : null),
    shield,
    unknownLines: unknownLines.slice(0, 5),
    omittedUnknownLines: Math.max(0, unknownLines.length - 5),
    issues,
    riskVerified: false,
    note: "事件是觀測或局部推導，不提供未來命中、吸血、閃避、終殺或承傷上界。",
  };
}

export function recentCombatEvents(store: WorkflowObservations, actor: string) {
  const record = store
    .all()
    .reverse()
    .find(
      (record) =>
        !record.message.outgoing &&
        record.actor === actor &&
        record.epoch === store.generation &&
        /^\/(?:attack(?:\s|$)|skill\s|flee$)/u.test(record.command ?? ""),
    );
  if (
    !record ||
    Date.now() < record.source.observedAt ||
    Date.now() < record.source.date * 1000 ||
    Date.now() - record.source.date * 1000 > 60_000
  ) {
    return null;
  }
  return parseCombatEvents(record.message.text, record.source);
}
