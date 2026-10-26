import { ledgerBindings } from "./ledger-attribution.js";
import {
  type LedgerCombat,
  type LedgerStatus,
  ledgerFact,
} from "./ledger-facts.js";
import {
  type Account,
  account,
  applyReceipt,
  changeGold,
  invalidate,
  type LedgerSource,
  ledgerSource,
  observeStatus,
  unknown,
} from "./ledger-resources.js";
import {
  LEDGER_PARSER_VERSION,
  type LedgerData,
  type LedgerObservation,
} from "./ledger-types.js";
import { WORKFLOW_QUERY } from "./workflow-parsers.js";

export {
  type LedgerSource,
  type LedgerValue,
  ledgerSource,
} from "./ledger-resources.js";

function ledgerContinuity(
  data: LedgerData,
  selected: ReturnType<typeof ledgerBindings>,
) {
  const firstSeen = new Map<number, { at: number; event: number }>();
  for (const obs of data.observations) {
    if (obs.firstEventId !== undefined && obs.firstObservedAt !== undefined) {
      firstSeen.set(obs.id, {
        at: obs.firstObservedAt,
        event: obs.firstEventId,
      });
    }
  }
  for (const event of data.events) {
    if (
      event.kind === "seen" &&
      !firstSeen.has(Number(event.data.observationId))
    ) {
      firstSeen.set(Number(event.data.observationId), {
        at: event.at,
        event: event.id,
      });
    }
  }

  let previousDate = 0;
  const consumedGaps = new Set<number>(),
    conflicted = new Set<number>();
  const gaps: { messageId: number | null; reason: string }[] = [];
  const before = new Map<number, { reset: boolean; clockInvalid: boolean }>();
  const events = [
    ...data.events.filter((e) => e.kind === "gap"),
    ...(data.externalBarriers ?? []),
  ];
  const reportedGaps = new Set<number>();
  for (const obs of selected.observations) {
    const message = obs.message,
      seen = firstSeen.get(obs.id);
    let reset = false;
    for (const id of selected.conflicts) {
      if (id < message.id && !conflicted.has(id)) {
        reset = true;
        conflicted.add(id);
      }
    }
    for (const event of events) {
      if (!consumedGaps.has(event.id) && event.id < (seen?.event ?? 0)) {
        reset = true;
        if (message.date * 1000 >= event.at) {
          consumedGaps.add(event.id);
        }
        if (!reportedGaps.has(event.id)) {
          reportedGaps.add(event.id);
          gaps.push({
            messageId: message.id,
            reason: "觀測缺頁、分支或落盤中斷；不延續推導。",
          });
        }
      }
    }
    const clockInvalid =
      message.date < previousDate || !seen || message.date * 1000 > seen.at;
    previousDate = Math.max(previousDate, message.date);
    if (clockInvalid) {
      gaps.push({
        messageId: message.id,
        reason: "遊戲或觀測時鐘異常；數值只保留為歷史事實。",
      });
    }
    before.set(obs.id, { reset, clockInvalid });
  }
  return {
    firstSeen,
    gaps,
    before,
    tailGap: events.some((e) => !consumedGaps.has(e.id)),
    externalOutstanding: (data.externalBarriers ?? []).filter(
      (e) => !consumedGaps.has(e.id),
    ).length,
  };
}

function invalidateUnresolved(
  data: LedgerData,
  bindings: ReturnType<typeof ledgerBindings>["bindings"],
  current: Account | undefined,
  firstSeen: Map<number, { at: number; event: number }>,
) {
  const latest = new Map<string, number>();
  for (const event of data.events) {
    if (event.operationId) {
      latest.set(event.operationId, event.id);
    }
  }
  const anchor = current?.lastStatus
    ? (firstSeen.get(current.lastStatus.source.observationId)?.event ?? 0)
    : 0;
  for (const binding of bindings) {
    if (
      binding.state !== "unresolved" ||
      binding.operation.kind === "history" ||
      WORKFLOW_QUERY.test(binding.command ?? "")
    ) {
      continue;
    }
    if ((latest.get(binding.operation.id) ?? 0) > anchor) {
      invalidate(current);
    }
  }
}

/** 歷史投影；每次由不可變原文重建，不影響即時 WorkflowObservations。 */
export function projectLedger(data: LedgerData, character?: string) {
  const selected = ledgerBindings(data);
  const accounts = new Map<string, Account>();
  const get = (name: string) => {
    const found = accounts.get(name) ?? account(name);
    accounts.set(name, found);
    return found;
  };
  const gaps: { messageId: number | null; reason: string }[] =
    selected.conflicts.map((messageId) => ({
      messageId,
      reason: "revision 先後未知，相依事實失效。",
    }));
  const echoBindings = new Map(
    selected.bindings.filter((b) => b.echo).map((b) => [b.echo?.id, b]),
  );
  const replyBindings = new Map(
    selected.bindings.flatMap((b) =>
      [b.reply, b.supplement]
        .filter((o): o is LedgerObservation => o !== null)
        .map((o) => [o.id, b] as const),
    ),
  );
  const owners = new Map<string, string | null>();
  const snapshots = new Map<
    string,
    {
      character: string | null;
      mpAfter: number | null;
      hpAfter: number | null;
      confirmedMpCost: number | null;
      source: LedgerSource | null;
    }
  >();
  const continuity = ledgerContinuity(data, selected),
    firstSeen = continuity.firstSeen;
  gaps.push(...continuity.gaps);
  let active: string | null = null;
  for (const obs of selected.observations) {
    const message = obs.message,
      facts = selected.facts.get(obs.id) ?? [],
      source = ledgerSource(obs);
    const { reset, clockInvalid } = continuity.before.get(obs.id) ?? {
      reset: true,
      clockInvalid: true,
    };
    if (reset || clockInvalid) {
      invalidate(active ? get(active) : undefined, true);
      active = null;
    }
    if (message.outgoing) {
      const binding = echoBindings.get(obs.id);
      if (binding) {
        owners.set(binding.operation.id, active);
      }
      if (/^\/char(?:\s|$)/u.test(message.text)) {
        invalidate(active ? get(active) : undefined, true);
        active = null;
      } else if (
        (!binding?.reply || binding.state === "unresolved") &&
        !WORKFLOW_QUERY.test(message.text)
      ) {
        invalidate(active ? get(active) : undefined, true);
        active = null;
      }
      continue;
    }
    const status = ledgerFact<LedgerStatus>(facts, "status");
    if (status) {
      active = status.name;
      const a = get(active);
      observeStatus(a, status, source, clockInvalid);
    }
    const idle = ledgerFact<{ character: string; gold: number }>(facts, "idle");
    if (idle) {
      // 其他角色獨立入帳；不切換目前操作角色或混入其塔帳。
      const a = get(idle.character);
      changeGold(a, idle.gold, 0, source, {
        firstClear: 0,
        repeatable: idle.gold,
        category: "idle",
      });
      if (active === idle.character) {
        a.hp = unknown();
        a.mp = unknown();
      }
      continue;
    }
    const binding = replyBindings.get(obs.id);
    if (!binding) {
      if (
        !status &&
        !["tower", "equipment", "skills"].some((k) => ledgerFact(facts, k))
      ) {
        invalidate(active ? get(active) : undefined);
        gaps.push({
          messageId: message.id,
          reason: "未歸屬的 bot 回覆；已保存原文，不猜本人資源。",
        });
      }
      continue;
    }
    const owner = status?.name ?? owners.get(binding.operation.id) ?? null;
    const a = owner ? get(owner) : null;
    const combat = ledgerFact<LedgerCombat>(facts, "combat");
    const cost = ledgerFact<{ amount: number }>(facts, "mp_cost");
    if (a && !clockInvalid && !status) {
      applyReceipt(a, binding, obs, facts, selected.facts);
    }
    if (cost && !owner) {
      gaps.push({
        messageId: message.id,
        reason: "技能成本已觀測，但角色歸屬未知，不併本人帳。",
      });
    }
    if (combat && !combat.complete) {
      gaps.push({
        messageId: message.id,
        reason: "戰鬥含未知或矛盾事件；獨立成本保留，HP／MP 推導失效。",
      });
    }
    snapshots.set(binding.operation.id, {
      character: owner,
      mpAfter: a?.mp.value ?? null,
      hpAfter: a?.hp.value ?? null,
      confirmedMpCost:
        cost?.amount ??
        snapshots.get(binding.operation.id)?.confirmedMpCost ??
        null,
      source,
    });
  }
  invalidateUnresolved(
    data,
    selected.bindings,
    active ? get(active) : undefined,
    firstSeen,
  );
  if (continuity.tailGap) {
    invalidate(active ? get(active) : undefined, true);
    active = null;
    gaps.push({
      messageId: null,
      reason:
        continuity.externalOutstanding > 0
          ? "此分支之外有較新的事件；Pi 分支不撤銷遊戲動作。"
          : "最後觀測後有資料缺口。",
    });
  }
  if (data.diagnostics.length > 0) {
    invalidate(active ? get(active) : undefined, true);
    active = null;
  }
  const current = character ?? active;
  const result = accounts.get(current ?? "") ?? null;
  return {
    parserVersion: LEDGER_PARSER_VERSION,
    character: current,
    activeCharacter: active,
    account: result,
    operations: selected.bindings.map((b) => ({
      id: b.operation.id,
      kind: b.operation.kind,
      command: b.command,
      state: b.state,
      reasons: b.reasons,
      ...snapshots.get(b.operation.id),
      source: b.reply ? ledgerSource(b.reply) : null,
    })),
    pending: selected.bindings
      .filter(
        (b) =>
          b.state === "unresolved" ||
          b.state === "prepared" ||
          b.state === "submitted",
      )
      .map((b) => b.operation.id),
    gaps,
    conflicts: selected.conflicts,
    externalEvents: continuity.externalOutstanding,
    diagnostics: data.diagnostics,
    operationalEligibility: false,
    riskVerified: false,
    note: "歷史觀測及局部推導，不刷新操作資格；護盾剩餘與保守耗次政策均未知。樣本不是承傷上界或 Goal 完成證據。",
  };
}
