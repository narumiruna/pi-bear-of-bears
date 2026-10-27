import {
  type LedgerCombat,
  type LedgerStatus,
  ledgerFact,
} from "./ledger-facts.js";
import type {
  LedgerData,
  LedgerFact,
  LedgerObservation,
  LedgerOperation,
  LedgerState,
} from "./ledger-types.js";
import { replayRewardEvent } from "./workflow-reward-replay.js";

export interface LedgerBinding {
  operation: LedgerOperation;
  command: string | null;
  state: LedgerState;
  echo: LedgerObservation | null;
  reply: LedgerObservation | null;
  supplement: LedgerObservation | null;
  reasons: string[];
}
export function effectiveLedger(data: LedgerData) {
  const versions = new Map<number, LedgerObservation[]>();
  for (const obs of data.observations) {
    versions.set(obs.message.id, [
      ...(versions.get(obs.message.id) ?? []),
      obs,
    ]);
  }
  const conflicts = [...versions]
    .filter(([, rows]) => rows.length > 1)
    .map(([id]) => id);
  // revision 沒有可比較的編輯時間；不採用「最後讀到」的版本。
  const observations = [...versions.values()]
    .filter((rows) => rows.length === 1)
    .flat()
    .sort((a, b) => a.message.id - b.message.id);
  const facts = new Map(data.facts.map((f) => [f.observationId, f.facts]));
  return { observations, facts, conflicts };
}
export function replayTransaction(
  obs: LedgerObservation,
  command: string | null,
) {
  return replayRewardEvent(
    {
      message: obs.message,
      command,
      actor: null,
      epoch: 0,
      source: {
        messageId: obs.message.id,
        revision: obs.message.revision,
        date: obs.message.date,
        observedAt: obs.message.date * 1000,
      },
    },
    [],
  );
}
function replyMatches(
  facts: LedgerFact[],
  obs: LedgerObservation,
  command: string | null,
) {
  const cost = ledgerFact<{ amount: number; skill: string | null }>(
    facts,
    "mp_cost",
  );
  if (cost?.skill) {
    return command === `/skill ${cost.skill}`;
  }
  if (ledgerFact(facts, "mp_rejected")) {
    return /^\/skill .+$/u.test(command ?? "");
  }
  if (ledgerFact<LedgerStatus>(facts, "status")) {
    return command === "/status";
  }
  if (ledgerFact(facts, "rest")) {
    return command === "/rest";
  }
  if (ledgerFact(facts, "flee")) {
    return command === "/flee";
  }
  if (ledgerFact(facts, "tower")) {
    return command === "/tower";
  }
  if (ledgerFact(facts, "skills")) {
    return command === "/skills";
  }
  const combat = ledgerFact<LedgerCombat>(facts, "combat");
  if (combat?.format === "labelled_replay") {
    return /^\/(?:skill|attack|flee)(?:\s|$)/u.test(command ?? "");
  }
  if (ledgerFact(facts, "tower_clear")) {
    return /^\/(?:tower|skill|attack)(?:\s|$)/u.test(command ?? "");
  }
  return (
    ledgerFact(facts, "compacted_transaction") !== null ||
    replayTransaction(obs, command) !== null
  );
}

/** 精確 outgoing echo＋唯一相符回執；不以時間最近、watch 先到或 submitted 推成功。 */
export function ledgerBindings(data: LedgerData) {
  const effective = effectiveLedger(data);
  const rows = effective.observations;
  const byId = new Map(rows.map((obs) => [obs.id, obs]));
  const byCommand = new Map<string, LedgerObservation[]>();
  const segments = new Map<number, LedgerObservation[]>();
  const byOperation = new Map<string, typeof data.events>();
  for (const event of data.events) {
    if (event.operationId) {
      const list = byOperation.get(event.operationId) ?? [];
      list.push(event);
      byOperation.set(event.operationId, list);
    }
  }
  let current: number | null = null;
  for (const obs of rows) {
    if (obs.message.outgoing) {
      current = obs.id;
      segments.set(current, []);
      const list = byCommand.get(obs.message.text) ?? [];
      list.push(obs);
      byCommand.set(obs.message.text, list);
    } else if (current !== null) {
      segments.get(current)?.push(obs);
    }
  }
  const bindings: LedgerBinding[] = data.operations.map((operation) => {
    const events = byOperation.get(operation.id) ?? [];
    const states = events.filter((e) => e.kind === "state");
    const last = states.at(-1)?.data.state;
    const dispatched = states.find((e) => e.data.state === "submitted");
    const command =
      typeof dispatched?.data.command === "string"
        ? dispatched.data.command
        : operation.command;
    const base = {
      operation,
      command,
      state: "unresolved" as LedgerState,
      echo: null,
      reply: null,
      supplement: null,
      reasons: [] as string[],
    };
    if (last === "not_dispatched") {
      return { ...base, state: "not_dispatched" as const };
    }
    if (operation.kind === "history") {
      return {
        ...base,
        state:
          last === "confirmed"
            ? ("confirmed" as const)
            : ("unresolved" as const),
      };
    }
    if (!dispatched || command === null) {
      return {
        ...base,
        reasons: ["缺少已落盤送達意圖或可辨識文字指令；不重送。"],
      };
    }
    const highWater = Number(dispatched.data.beforeMax);
    if (!Number.isSafeInteger(highWater) || highWater < 0) {
      return { ...base, reasons: ["缺少送出前訊息邊界。"] };
    }
    // 先採本次 after 頁；空頁才由後續觀測找精確 echo，重複指令仍可能保持未決。
    const afterIds = new Set(
      events
        .filter((e) => e.kind === "seen" && e.data.phase === "after")
        .map((e) => Number(e.data.observationId)),
    );
    const direct = [...afterIds].flatMap((id) => {
      const obs = byId.get(id);
      return obs?.message.outgoing &&
        obs.message.id > highWater &&
        obs.message.text === command
        ? [obs]
        : [];
    });
    const echoes =
      direct.length > 0
        ? direct
        : (byCommand.get(command) ?? []).filter(
            (obs) => obs.message.id > highWater,
          );
    if (echoes.length !== 1) {
      return { ...base, reasons: ["精確 outgoing echo 缺漏或不唯一。"] };
    }
    const echo = echoes[0];
    const replies = (segments.get(echo.id) ?? []).filter((obs) =>
      replyMatches(effective.facts.get(obs.id) ?? [], obs, command),
    );
    const supplements = replies.filter(
      (obs) =>
        ledgerFact(effective.facts.get(obs.id) ?? [], "tower_clear") !== null,
    );
    const main = replies.filter((obs) => !supplements.includes(obs));
    const reply =
      main.length === 1
        ? main[0]
        : main.length === 0 && supplements.length === 1
          ? supplements[0]
          : null;
    if (!reply || supplements.length > 1) {
      return {
        ...base,
        echo,
        reasons: ["相符回執缺漏、重複或互相矛盾；不猜操作結果。"],
      };
    }
    const rejected = ledgerFact(
      effective.facts.get(reply.id) ?? [],
      "mp_rejected",
    );
    return {
      ...base,
      echo,
      reply,
      supplement: supplements[0] !== reply ? (supplements[0] ?? null) : null,
      state: rejected ? ("rejected" as const) : ("confirmed" as const),
    };
  });
  const echoes = new Map<number, LedgerBinding[]>();
  for (const binding of bindings) {
    if (binding.echo) {
      echoes.set(binding.echo.id, [
        ...(echoes.get(binding.echo.id) ?? []),
        binding,
      ]);
    }
  }
  for (const repeated of echoes.values()) {
    if (repeated.length > 1) {
      for (const binding of repeated) {
        binding.state = "unresolved";
        binding.reply = null;
        binding.supplement = null;
        binding.reasons.push("多筆操作競爭同一 outgoing echo，不建立歸屬。");
      }
    }
  }
  return { ...effective, bindings };
}
