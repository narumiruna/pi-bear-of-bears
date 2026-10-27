import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { ledgerBindings, replayTransaction } from "./ledger-attribution.js";
import { type LedgerCombat, ledgerFact } from "./ledger-facts.js";
import { projectLedger } from "./ledger-projection.js";
import { retentionPatterns } from "./ledger-retention-digest.js";
import type { LedgerStore } from "./ledger-store.js";
import {
  LEDGER_PARSER_VERSION,
  type LedgerData,
  type LedgerEvent,
  type LedgerReference,
} from "./ledger-types.js";

const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export interface RetentionCheckpoint {
  version: 1;
  parserVersion: number;
  id: string;
  from: number;
  through: number;
  deletedEvents: number;
  contexts: string[];
  /** 去重的機器事實索引，不是LLM推測；原事件列會實際刪除。 */
  events: LedgerEvent[];
  summaryReference: string;
  sourceHash: string;
  at: number;
}
export function installRetentionSchema(db: DatabaseSync) {
  db.exec(`CREATE TABLE IF NOT EXISTS ledger_maintenance(id INTEGER PRIMARY KEY CHECK(id=1), owner TEXT NOT NULL, expires_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS ledger_seen_observation ON events(json_extract(data,'$.observationId')) WHERE kind='seen';
    CREATE TABLE IF NOT EXISTS ledger_compactions(id TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS ledger_compacted_observations(observation_id INTEGER PRIMARY KEY REFERENCES observations(id), hash TEXT NOT NULL, checkpoint_id TEXT NOT NULL REFERENCES ledger_compactions(id));`);
}
export function retentionCheckpoints(db: DatabaseSync): RetentionCheckpoint[] {
  return db
    .prepare("SELECT data FROM ledger_compactions ORDER BY rowid")
    .all()
    .map((row) => {
      const checkpoint = JSON.parse(String(row.data)) as RetentionCheckpoint;
      if (checkpoint.version !== 1 || !Array.isArray(checkpoint.events)) {
        throw new Error("不支援的壓縮checkpoint格式；未重建或刪資料。");
      }
      return checkpoint;
    });
}
export function canonicalEvents(events: LedgerEvent[]) {
  const selected = new Map<string, LedgerEvent>();
  for (const event of events) {
    if (event.kind === "metric" || event.kind === "usage") {
      continue;
    }
    const key =
      event.kind === "seen"
        ? `${event.contextId}:${event.operationId}:${event.data.phase}:${event.data.observationId}`
        : event.kind === "state"
          ? `state:${event.id}`
          : `gap:${event.id}`;
    if (event.kind === "seen" || event.data.state === "submitted") {
      if (!selected.has(key)) {
        selected.set(key, event);
      }
    } else {
      selected.set(key, event);
    }
  }
  return [...selected.values()].sort((a, b) => a.id - b.id);
}
export interface RetentionPlan {
  version: 1;
  id: string;
  sourceHash: string;
  through: number;
  contexts: string[];
  eventIds: number[];
  checkpointEvents: LedgerEvent[];
  observationIds: number[];
  accountingHash: string;
  digest: string;
}
/** 不刪未決操作，不拆跨邊界context；所有選擇以單一watermark固定。 */
export function prepareRetention(
  store: LedgerStore,
  minimumEvents = 180000,
): RetentionPlan | null {
  const db = store.db;
  const rows = store.eventRows(true);
  if (rows.length < minimumEvents) {
    return null;
  }
  const through = Number(rows[Math.floor(rows.length / 2) - 1]?.id ?? 0);
  if (!through) {
    return null;
  }
  const allRefs = retentionReferences(db);
  const data = store.read(allRefs, true);
  const bindings = ledgerBindings(data);
  const protectedContexts = new Set(
    bindings.bindings
      .filter(
        (b) => !["confirmed", "rejected", "not_dispatched"].includes(b.state),
      )
      .map((b) => b.operation.contextId),
  );
  const contexts = db
    .prepare(
      "SELECT context_id FROM events GROUP BY context_id HAVING MAX(id)<=?",
    )
    .all(through)
    .map((r) => String(r.context_id))
    .filter((id) => !protectedContexts.has(id));
  const chosen = new Set(contexts);
  const liveIds = new Set(rows.map((r) => Number(r.id)));
  const events = data.events.filter(
    (e) => chosen.has(e.contextId) && e.id <= through && liveIds.has(e.id),
  );
  if (events.length === 0) {
    return null;
  }
  if (rows.length >= 180000 && rows.length - events.length >= 180000) {
    throw new Error(
      "可安全回收範圍不足以降到觸發線以下；保留未決與跨界context，不反覆spawn或為湊數刪除。",
    );
  }
  const sourceHash = hash(rows);
  const observationIds = [
    ...new Set(
      events
        .filter((e) => e.kind === "seen")
        .map((e) => Number(e.data.observationId)),
    ),
  ];
  const accountings = checkpointAccounting(data);
  const observed = retentionPatterns(data, observationIds);
  const digest = JSON.stringify({
    version: 1,
    totalsScope:
      "全庫已解析且歸屬確認的已知收支小計，不是完整實際總額或候選區間收益；缺漏與未決另列",
    scope: { from: events[0].id, through, events: events.length },
    characters: accountings.accounts.map((a) => ({
      character: a.character,
      mpSpent: a.account?.mpSpent,
      mpRecovered: a.account?.mpRecovered,
      credits: a.account?.credits,
      debits: a.account?.debits,
      firstClear: a.account?.firstClear,
      repeatable: a.account?.repeatable,
      clearedFloors: [
        ...new Set(a.account?.clears.map((c) => c.floor) ?? []),
      ].sort((a, b) => a - b),
      formalClearReceipts: a.account?.clears.length ?? 0,
      firstClearSource: a.account?.clears[0]?.source ?? null,
      lastClearSource: a.account?.clears.at(-1)?.source ?? null,
    })),
    patterns: observed.patterns,
    omittedPatterns: observed.omittedPatterns,
    patternLimitations: observed.note,
    pending: accountings.pending.slice(0, 20),
    pendingOmitted: Math.max(0, accountings.pending.length - 20),
    conflicts: accountings.conflicts.slice(0, 20),
    conflictsOmitted: Math.max(0, accountings.conflicts.length - 20),
    unknowns: accountings.gaps.slice(-30),
    unknownsOmitted: Math.max(0, accountings.gaps.length - 30),
    note: "這些是歷史條件觀測，不是通用公式、安全上界或即時資格。原始證據將在驗證後壓縮；不可編造缺值。",
  });
  if (Buffer.byteLength(digest) > 120000) {
    throw new Error("壓縮摘要輸入超出預算；不刪資料。");
  }
  const accountingHash = hash(accountings);
  const id = hash({
    version: 1,
    sourceHash,
    contexts,
    through,
    accountingHash,
    digest,
  });
  return {
    version: 1,
    id,
    sourceHash,
    through,
    contexts,
    eventIds: events.map((e) => e.id),
    checkpointEvents: canonicalEvents(events),
    observationIds,
    accountingHash,
    digest,
  };
}
function checkpointAccounting(data: LedgerData) {
  const selected = projectLedger(data);
  const names = [
    ...new Set(
      data.facts.flatMap((row) =>
        row.facts.flatMap((f) =>
          f.kind === "status"
            ? [String((f.value as { name: string }).name)]
            : f.kind === "idle"
              ? [String((f.value as { character: string }).character)]
              : [],
        ),
      ),
    ),
  ].sort();
  return {
    accounts: names.map((character) => ({
      character,
      account: projectLedger(data, character).account,
    })),
    active: selected.activeCharacter,
    pending: selected.pending,
    conflicts: selected.conflicts,
    gaps: selected.gaps,
    operations: selected.operations.sort((a, b) => a.id.localeCompare(b.id)),
  };
}
export function retentionReferences(db: DatabaseSync): LedgerReference[] {
  const limits = new Map<string, number>();
  for (const c of retentionCheckpoints(db)) {
    for (const e of c.events) {
      limits.set(e.contextId, Math.max(limits.get(e.contextId) ?? 0, e.id));
    }
  }
  for (const row of db
    .prepare(
      "SELECT context_id,MAX(id) through FROM events GROUP BY context_id",
    )
    .all()) {
    limits.set(String(row.context_id), Number(row.through));
  }
  return [...limits].map(([contextId, through]) => ({ contextId, through }));
}
/** LLM只交摘要；先寫成功取得固定reference才可進入此排他交易。 */
export function commitRetention(
  store: LedgerStore,
  plan: RetentionPlan,
  summaryReference: string,
  signal?: AbortSignal,
) {
  if (!summaryReference || summaryReference.length > 1000) {
    throw new Error("缺少已落盤的摘要引用。");
  }
  signal?.throwIfAborted();
  return store.transaction(() => {
    const db = store.db;
    const done = db
      .prepare("SELECT data FROM ledger_compactions WHERE id=?")
      .get(plan.id);
    if (done) {
      return JSON.parse(String(done.data)) as RetentionCheckpoint;
    }
    const currentRows = store.eventRows(true);
    if (hash(currentRows) !== plan.sourceHash) {
      throw new Error("壓縮準備後來源已變更；不刪資料。");
    }
    const fresh = prepareRetention(store, Math.max(currentRows.length, 1));
    if (!fresh || hash(fresh) !== hash(plan)) {
      throw new Error("壓縮manifest不符；不刪資料。");
    }
    const before = store.read(retentionReferences(db), true);
    if (hash(checkpointAccounting(before)) !== plan.accountingHash) {
      throw new Error("帳務邊界變更；不刪資料。");
    }
    const checkpoint: RetentionCheckpoint = {
      version: 1,
      parserVersion: LEDGER_PARSER_VERSION,
      id: plan.id,
      from: plan.eventIds[0],
      through: plan.through,
      deletedEvents: plan.eventIds.length,
      contexts: plan.contexts,
      events: plan.checkpointEvents,
      summaryReference,
      sourceHash: plan.sourceHash,
      at: Date.now(),
    };
    db.prepare("INSERT INTO ledger_compactions VALUES(?,?)").run(
      plan.id,
      JSON.stringify(checkpoint),
    );
    // 所有仍被原始event引用的觀測保留全文；已結案且只剩checkpoint者才移除原文。
    const remove = db.prepare(
        "DELETE FROM operation_observations WHERE event_id=?",
      ),
      del = db.prepare("DELETE FROM events WHERE id=?");
    for (const id of plan.eventIds) {
      remove.run(id);
      del.run(id);
    }
    const facts = new Map(before.facts.map((f) => [f.observationId, f.facts]));
    const owners = new Map(
      ledgerBindings(before).bindings.flatMap((b) =>
        [b.reply, b.supplement].flatMap((o) =>
          o ? [[o.id, b.command] as const] : [],
        ),
      ),
    );
    for (const id of plan.observationIds) {
      if (
        db
          .prepare(
            "SELECT 1 FROM events WHERE kind='seen' AND json_extract(data,'$.observationId')=?",
          )
          .get(id)
      ) {
        continue;
      }
      if (
        db
          .prepare(
            "SELECT 1 FROM ledger_compacted_observations WHERE observation_id=?",
          )
          .get(id)
      ) {
        continue;
      }
      const obs = before.observations.find((o) => o.id === id);
      if (!obs) {
        throw new Error("壓縮觀測來源缺漏。");
      }
      const parsed = facts.get(id) ?? [];
      // hash-only技能／裝備、未知格式及不完整戰鬥仍可能是唯一重要證據，保留全文。
      if (
        obs.message.outgoing ||
        !(
          ledgerFact<LedgerCombat>(parsed, "combat")?.complete ||
          ledgerFact(parsed, "rest") ||
          ledgerFact<{ format?: string }>(parsed, "tower_clear")?.format ===
            "labelled_replay"
        )
      ) {
        continue;
      }
      const transaction = obs.message.outgoing
        ? null
        : replayTransaction(obs, owners.get(id) ?? null);
      if (transaction) {
        const fs = facts.get(id) ?? [];
        db.prepare(
          "UPDATE facts SET data=? WHERE observation_id=? AND parser_version=?",
        ).run(
          JSON.stringify([
            ...fs,
            {
              line: 1,
              kind: "compacted_transaction",
              basis: "observed",
              value: transaction,
            },
          ]),
          id,
          before.facts.find((f) => f.observationId === id)?.parserVersion ?? 0,
        );
      }
      db.prepare("INSERT INTO ledger_compacted_observations VALUES(?,?,?)").run(
        id,
        hash(obs.message),
        plan.id,
      );
      const message = {
        ...obs.message,
        text: obs.message.outgoing
          ? obs.message.text
          : "【原文已壓縮；僅保留機器事實與摘要】",
        buttons: [],
      };
      db.prepare("UPDATE observations SET data=?,original=NULL WHERE id=?").run(
        JSON.stringify(message),
        id,
      );
    }
    signal?.throwIfAborted();
    const after = store.read(retentionReferences(db), true);
    if (hash(checkpointAccounting(after)) !== plan.accountingHash) {
      throw new Error("壓縮後帳務不一致；交易已回滾。");
    }
    return checkpoint;
  });
}
