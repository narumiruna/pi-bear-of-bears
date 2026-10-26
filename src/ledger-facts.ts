import { createHash } from "node:crypto";
import { parseCombatEvents } from "./combat-events.js";
import type { GameMessage } from "./game.js";
import { parseInventory } from "./inventory.js";
import type { LedgerFact } from "./ledger-types.js";
import { idleReportFacts } from "./workflow-events.js";
import {
  numberValue,
  skillsFacts,
  statusFacts,
  towerFacts,
} from "./workflow-parsers.js";
import { statusReplyComplete } from "./workflow-status-reply.js";

export type LedgerCombat = ReturnType<typeof parseCombatEvents>;
export type LedgerStatus = NonNullable<ReturnType<typeof statusFacts>>;
export type LedgerRest =
  | { full: true; format: "labelled_replay" }
  | {
      full: true;
      format: "native";
      hp: number;
      maxHp: number;
      mp: number;
      maxMp: number;
    };
export const fingerprint = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function ledgerFact<T>(
  facts: readonly LedgerFact[],
  kind: string,
): T | null {
  return (facts.find((f) => f.kind === kind)?.value as T | undefined) ?? null;
}

/** 僅新增記帳事實；不改共用 parser 的 complete 或安全護欄。 */
export function parseLedgerFacts(
  message: GameMessage,
  observedAt: number,
): LedgerFact[] {
  if (message.outgoing) {
    return [
      { line: 1, kind: "outgoing", value: message.text, basis: "observed" },
    ];
  }
  const facts: LedgerFact[] = [];
  const add = (
    kind: string,
    value: unknown,
    line = 1,
    basis: LedgerFact["basis"] = "observed",
  ) => facts.push({ line, kind, value, basis });
  const status = statusFacts(message);
  if (status && statusReplyComplete(message.text) && !status.estimated) {
    add("status", status);
  }
  const idle = idleReportFacts(message.text);
  if (idle) {
    add("idle", idle);
  }
  const tower = towerFacts(message.text);
  if (tower) {
    add("tower", tower);
  }
  const skills = skillsFacts(message.text);
  if (skills) {
    add("skills", {
      version: fingerprint(skills),
      coverage: "parsed_entries_only",
    });
  }
  if (/^🎒 背包/u.test(message.text)) {
    const inventory = parseInventory(message);
    if (inventory?.complete) {
      add("equipment", {
        version: fingerprint(
          inventory.entries
            .filter((entry) => entry.equipped)
            .map(({ id: _id, ...entry }) => entry),
        ),
        coverage: "single_complete_inventory",
      });
    }
  }
  if (/^(?:✨ 使用技能：|戰鬥紀錄：)/u.test(message.text)) {
    const combat = parseCombatEvents(message.text, {
      messageId: message.id,
      revision: message.revision,
      date: message.date,
      observedAt,
    });
    add("combat", combat);
    const costs = combat.events.filter((e) => e.kind === "mp_cost");
    // 未知尾文不能抹除唯一標頭的獨立成本，但不因此推導餘額。
    if (costs.length === 1 && typeof costs[0].nominal?.value === "number") {
      add(
        "mp_cost",
        {
          amount: costs[0].nominal?.value,
          skill: combat.format === "native_skill" ? costs[0].description : null,
        },
        costs[0].line,
      );
    }
  }
  const rejected = /^MP 不足！需要 ([\d,]+) MP，目前 ([\d,]+) MP。$/u.exec(
    message.text,
  );
  if (rejected) {
    const needed = numberValue(rejected[1]),
      current = numberValue(rejected[2]);
    if (needed !== null && current !== null && current < needed) {
      add("mp_rejected", { needed, current });
    }
  }
  // 既有離線 replay 協定；沒有數值時只確認恢復回執，不補造最大值。
  if (message.text === "免費休息，HP／MP 已恢復。") {
    add("rest", { full: true, format: "labelled_replay" });
  }
  // 818932 原生回覆：只接受完整兩行且明示補滿的有限整數。
  const nativeRest =
    /^💤 充分休息後恢復了！\nHP：(\d+)\/(\d+)　MP：(\d+)\/(\d+)$/u.exec(
      message.text,
    );
  if (nativeRest) {
    const [hp, maxHp, mp, maxMp] = nativeRest.slice(1).map(numberValue);
    if (
      hp !== null &&
      maxHp !== null &&
      mp !== null &&
      maxMp !== null &&
      maxHp > 0 &&
      hp === maxHp &&
      mp === maxMp
    ) {
      add("rest", {
        full: true,
        format: "native",
        hp,
        maxHp,
        mp,
        maxMp,
      } satisfies LedgerRest);
    }
  }
  // 不從收刀回覆推HP／MP不變；只讓同指令的唯一回覆保留角色歸屬。
  if (
    message.text === "💨 你趁亂逃跑了！" ||
    message.text === "你沒有在戰鬥中。"
  ) {
    add("flee", { format: "native" });
  }
  const clear =
    /^通層回執：第([1-9]\d*)層\n怪金：([\d,]+)G\n首達：([\d,]+)G\n合計：([\d,]+)G$/u.exec(
      message.text,
    );
  if (clear) {
    const [floor, repeatable, firstClear, total] = clear
      .slice(1)
      .map(numberValue);
    if (
      [floor, repeatable, firstClear, total].every((v) => v !== null) &&
      Number.isSafeInteger((repeatable ?? 0) + (firstClear ?? 0)) &&
      total === (repeatable ?? 0) + (firstClear ?? 0)
    ) {
      add("tower_clear", {
        floor,
        repeatable,
        firstClear,
        total,
        format: "labelled_replay",
      });
    }
  }
  return facts;
}
