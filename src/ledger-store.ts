import { randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { privateFile, privateLedgerDirectory } from "./ledger-files.js";

export { privateLedgerDirectory } from "./ledger-files.js";

import { DatabaseSync } from "node:sqlite";
import type { GameMessage } from "./game.js";
import { externalLedgerBarriers } from "./ledger-external.js";
import { fingerprint, parseLedgerFacts } from "./ledger-facts.js";
import { ledgerMessage } from "./ledger-privacy.js";
import {
  installRetentionSchema,
  retentionCheckpoints,
} from "./ledger-retention.js";
import {
  LEDGER_PARSER_VERSION,
  type LedgerContext,
  type LedgerData,
  type LedgerEvent,
  type LedgerOperation,
  type LedgerReference,
} from "./ledger-types.js";

const MAX_EVENTS = 200_000;
const json = (value: unknown) => JSON.stringify(value);
const decode = <T>(raw: unknown): T => JSON.parse(String(raw)) as T;

export class LedgerStore {
  readonly db: DatabaseSync;
  private closed = false;
  constructor(
    readonly path: string,
    readonly account: string,
  ) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/u.test(account)) {
      throw new Error("帳本命名空間必須是 1–64 個英數字、底線或連字號。");
    }
    if (!isAbsolute(path)) {
      throw new Error("記帳檔案必須是絕對路徑。");
    }
    privateLedgerDirectory(dirname(path));
    privateFile(this.path, true);
    privateFile(`${this.path}-wal`, false);
    privateFile(`${this.path}-shm`, false);
    this.db = new DatabaseSync(this.path);
    try {
      this.db.exec("PRAGMA busy_timeout=1000; PRAGMA foreign_keys=ON;");
      const version = Number(
        this.db.prepare("PRAGMA user_version").get()?.user_version,
      );
      if (version !== 0 && version !== 1) {
        throw new Error("不支援的記帳 schema；未遷移或刪除資料。");
      }
      if (version === 0) {
        this.migrate();
      }
      const owner = this.db
        .prepare("SELECT account FROM ledger_meta WHERE id=1")
        .get();
      if (owner?.account !== account) {
        throw new Error("記帳帳號命名空間不符。");
      }
      this.db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;");
      installRetentionSchema(this.db);
      this.integrity();
    } catch (error) {
      this.db.close();
      throw error;
    }
  }
  private migrate() {
    // 新庫 v0→v1；既有非空未知 DB 不視為可初始化的空庫。
    const tables = this.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all();
    if (tables.length > 0) {
      throw new Error("未識別的非空資料庫，拒絕初始化。");
    }
    this.transaction(() => {
      this.db.exec(`
        CREATE TABLE ledger_meta(id INTEGER PRIMARY KEY CHECK(id=1), account TEXT NOT NULL);
        CREATE TABLE contexts(id TEXT PRIMARY KEY, data TEXT NOT NULL);
        CREATE TABLE operations(id TEXT PRIMARY KEY, context_id TEXT NOT NULL REFERENCES contexts(id), data TEXT NOT NULL);
        CREATE TABLE observations(id INTEGER PRIMARY KEY, message_id INTEGER NOT NULL, revision TEXT NOT NULL, data TEXT NOT NULL, original TEXT, UNIQUE(message_id, revision));
        CREATE TABLE facts(observation_id INTEGER NOT NULL REFERENCES observations(id), parser_version INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY(observation_id, parser_version));
        CREATE TABLE events(id INTEGER PRIMARY KEY AUTOINCREMENT, context_id TEXT NOT NULL REFERENCES contexts(id), operation_id TEXT REFERENCES operations(id), at INTEGER NOT NULL, kind TEXT NOT NULL, data TEXT NOT NULL);
        CREATE TABLE operation_observations(operation_id TEXT NOT NULL REFERENCES operations(id), observation_id INTEGER NOT NULL REFERENCES observations(id), event_id INTEGER NOT NULL REFERENCES events(id), PRIMARY KEY(operation_id, observation_id, event_id));
        CREATE TABLE projections(key TEXT PRIMARY KEY, parser_version INTEGER NOT NULL, data TEXT NOT NULL);
        CREATE INDEX events_context ON events(context_id,id);
        PRAGMA user_version=1;
      `);
      this.db.prepare("INSERT INTO ledger_meta VALUES(1,?)").run(this.account);
    });
  }
  transaction<T>(work: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = work();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  context(context: LedgerContext) {
    this.capacity();
    this.db
      .prepare("INSERT INTO contexts VALUES(?,?)")
      .run(context.id, json(context));
  }
  operation(operation: LedgerOperation) {
    this.db
      .prepare("INSERT INTO operations VALUES(?,?,?)")
      .run(operation.id, operation.contextId, json(operation));
  }
  event(
    contextId: string,
    operationId: string | null,
    kind: LedgerEvent["kind"],
    data: Record<string, unknown>,
    at = Date.now(),
  ) {
    if (!Number.isSafeInteger(at) || at < 0) {
      throw new Error("記帳時間無效。");
    }
    if (
      this.db
        .prepare("SELECT 1 FROM ledger_maintenance WHERE expires_at>?")
        .get(Date.now())
    ) {
      throw new Error("帳本壓縮中；事件未寫入。");
    }
    this.capacity(false);
    // 同一 SQL 內核額度與寫入，避免流程內多事件或多連線超過上限。
    const result = this.db
      .prepare(
        "INSERT INTO events(context_id,operation_id,at,kind,data) SELECT ?,?,?,?,? WHERE (SELECT COUNT(*) FROM events) < ? AND NOT EXISTS(SELECT 1 FROM ledger_maintenance WHERE expires_at>?)",
      )
      .run(
        contextId,
        operationId,
        at,
        kind,
        json(data),
        MAX_EVENTS,
        Date.now(),
      );
    if (Number(result.changes) !== 1) {
      throw new Error("記帳超過事件上限；請先封存。");
    }
    return Number(result.lastInsertRowid);
  }
  observe(
    contextId: string,
    operationId: string | null,
    messages: readonly GameMessage[],
    phase: string,
    at = Date.now(),
  ) {
    return this.transaction(() => {
      let through = 0;
      for (const input of messages) {
        const message = ledgerMessage(input);
        if (
          !Number.isSafeInteger(message.id) ||
          message.id <= 0 ||
          !Number.isSafeInteger(message.date) ||
          message.date < 0 ||
          !message.revision ||
          message.text.length > 262_144
        ) {
          throw new Error("記帳訊息來源無效或超限。");
        }
        const raw = json(message);
        this.db
          .prepare(
            "INSERT OR IGNORE INTO observations(message_id,revision,data) VALUES(?,?,?)",
          )
          .run(message.id, message.revision, raw);
        const row = this.db
          .prepare(
            "SELECT id,data FROM observations WHERE message_id=? AND revision=?",
          )
          .get(message.id, message.revision);
        if (!row) {
          throw new Error("相同訊息 revision 的內容矛盾。");
        }
        const compacted = this.db
          .prepare(
            "SELECT hash FROM ledger_compacted_observations WHERE observation_id=?",
          )
          .get(Number(row.id));
        if (
          compacted ? compacted.hash !== fingerprint(message) : row.data !== raw
        ) {
          throw new Error("相同訊息 revision 的內容矛盾。");
        }
        const id = Number(row.id);
        this.db
          .prepare("INSERT OR IGNORE INTO facts VALUES(?,?,?)")
          .run(id, LEDGER_PARSER_VERSION, json(parseLedgerFacts(message, at)));
        through = this.event(
          contextId,
          operationId,
          "seen",
          { observationId: id, phase },
          at,
        );
        if (operationId) {
          this.db
            .prepare("INSERT INTO operation_observations VALUES(?,?,?)")
            .run(operationId, id, through);
        }
      }
      return through;
    });
  }
  original(messages: readonly GameMessage[], source: string) {
    if (!/^[a-f0-9-]{36}$/u.test(source)) {
      return;
    }
    this.transaction(() => {
      for (const message of messages) {
        this.db
          .prepare(
            "UPDATE observations SET original=COALESCE(original,?) WHERE message_id=? AND revision=?",
          )
          .run(source, message.id, message.revision);
      }
    });
  }
  /** 所有 facts 可由保留的原文重建；不刪舊 parser 版本。 */
  reparse() {
    this.transaction(() => {
      for (const row of this.db
        .prepare(
          "SELECT id,data FROM observations WHERE id NOT IN (SELECT observation_id FROM ledger_compacted_observations)",
        )
        .all()) {
        const message = decode<GameMessage>(row.data);
        this.db
          .prepare("INSERT OR IGNORE INTO facts VALUES(?,?,?)")
          .run(
            Number(row.id),
            LEDGER_PARSER_VERSION,
            json(
              parseLedgerFacts(
                message,
                Number(
                  this.db
                    .prepare(
                      "SELECT MIN(at) AS at FROM events WHERE kind='seen' AND json_extract(data,'$.observationId')=?",
                    )
                    .get(Number(row.id))?.at ?? 0,
                ),
              ),
            ),
          );
      }
      // 匯出所有權 hash 是防覆寫中繼資料，不是可重建的資源投影。
      this.db.exec(
        "DELETE FROM projections WHERE key NOT LIKE 'checkpoint_export:%'",
      );
    });
  }
  /** 一般投影與維修共用既有限額，先限SQL列數再建立manifest或機器事實。 */
  eventRows(retention = false) {
    this.capacity(false);
    const rows = this.db
      .prepare("SELECT * FROM events ORDER BY id LIMIT ?")
      .all(retention ? MAX_EVENTS + 1000 : MAX_EVENTS + 1);
    if (retention && rows.length >= MAX_EVENTS + 1000) {
      throw new Error("超出有界維修讀取上限；未壓縮或刪除。");
    }
    if (!retention && rows.length > MAX_EVENTS) {
      throw new Error("記帳超過 200000 個事件；請先封存。");
    }
    return rows;
  }
  read(references: LedgerReference[], retention = false): LedgerData {
    const rows = this.eventRows(retention);
    const limits = new Map<string, number>();
    for (const ref of references) {
      if (Number.isSafeInteger(ref.through) && ref.through > 0) {
        limits.set(
          ref.contextId,
          Math.max(limits.get(ref.contextId) ?? 0, ref.through),
        );
      }
    }
    const checkpoints = retentionCheckpoints(this.db);
    const allEvents = [
      ...checkpoints.flatMap((c) => c.events),
      ...rows.map((row) => ({
        id: Number(row.id),
        contextId: String(row.context_id),
        operationId:
          row.operation_id === null ? null : String(row.operation_id),
        at: Number(row.at),
        kind: String(row.kind) as LedgerEvent["kind"],
        data: decode<Record<string, unknown>>(row.data),
      })),
    ].sort((a, b) => a.id - b.id);
    const events = allEvents.filter(
      (event) => event.id <= (limits.get(event.contextId) ?? 0),
    );
    const firstSeen = new Map<
      number,
      { firstEventId: number; firstObservedAt: number }
    >();
    for (const event of allEvents) {
      if (
        event.kind === "seen" &&
        !firstSeen.has(Number(event.data.observationId))
      ) {
        firstSeen.set(Number(event.data.observationId), {
          firstEventId: event.id,
          firstObservedAt: event.at,
        });
      }
    }
    const observationIds = new Set(
      events
        .filter((e) => e.kind === "seen")
        .map((e) => Number(e.data.observationId)),
    );
    const operationIds = new Set(
      events.flatMap((e) => (e.operationId ? [e.operationId] : [])),
    );
    const observations = [...observationIds].map((id) => {
      const row = this.db
        .prepare("SELECT * FROM observations WHERE id=?")
        .get(id);
      if (!row) {
        throw new Error("原文來源遺失。");
      }
      return {
        id,
        ...firstSeen.get(id),
        message: decode<GameMessage>(row.data),
        ...(row.original ? { originalSourceId: String(row.original) } : {}),
      };
    });
    const facts = observations.map((obs) => {
      const row = this.db
        .prepare(
          "SELECT * FROM facts WHERE observation_id=? AND parser_version=?",
        )
        .get(obs.id, LEDGER_PARSER_VERSION);
      if (
        !row &&
        this.db
          .prepare(
            "SELECT 1 FROM ledger_compacted_observations WHERE observation_id=?",
          )
          .get(obs.id)
      ) {
        throw new Error(
          "已壓縮來源缺少目前parser事實；不能從已刪原文重建或猜測。",
        );
      }
      return {
        observationId: obs.id,
        parserVersion: LEDGER_PARSER_VERSION,
        facts: row ? decode<ReturnType<typeof parseLedgerFacts>>(row.data) : [],
      };
    });
    const operationCache = new Map<string, LedgerOperation | undefined>();
    const getOperation = (id: string) => {
      if (!operationCache.has(id)) {
        const row = this.db
          .prepare("SELECT data FROM operations WHERE id=?")
          .get(id);
        operationCache.set(
          id,
          row ? decode<LedgerOperation>(row.data) : undefined,
        );
      }
      return operationCache.get(id);
    };
    const externalBarriers = externalLedgerBarriers(
      allEvents,
      new Set(events.map((e) => e.id)),
      observationIds,
      getOperation,
    );
    return {
      contexts: [...new Set(events.map((e) => e.contextId))].map((id) =>
        decode<LedgerContext>(
          this.db.prepare("SELECT data FROM contexts WHERE id=?").get(id)?.data,
        ),
      ),
      operations: [...operationIds].map((id) =>
        decode<LedgerOperation>(
          this.db.prepare("SELECT data FROM operations WHERE id=?").get(id)
            ?.data,
        ),
      ),
      observations,
      facts,
      events,
      externalEvents: externalBarriers.length,
      externalBarriers,
      compactions: checkpoints.map(
        ({ events: _events, ...metadata }) => metadata,
      ),
      diagnostics:
        !retention && rows.length >= MAX_EVENTS
          ? ["帳本已達事件上限；唯讀查閱仍可用，寫入已停止，請先備份並封存。"]
          : [],
    };
  }
  trace(id: number) {
    const row = this.db
      .prepare("SELECT * FROM observations WHERE id=?")
      .get(id);
    return row
      ? {
          id,
          message: decode<GameMessage>(row.data),
          originalSourceId: row.original ?? null,
          compacted:
            this.db
              .prepare(
                "SELECT checkpoint_id FROM ledger_compacted_observations WHERE observation_id=?",
              )
              .get(id) ?? null,
          versions: this.db
            .prepare(
              "SELECT parser_version,data FROM facts WHERE observation_id=? ORDER BY parser_version",
            )
            .all(id)
            .map((f) => ({
              parserVersion: Number(f.parser_version),
              facts: decode<unknown>(f.data),
            })),
        }
      : null;
  }
  cached<T>(key: string): T | null {
    const row = this.db
      .prepare("SELECT data FROM projections WHERE key=? AND parser_version=?")
      .get(key, LEDGER_PARSER_VERSION);
    return row ? decode<T>(row.data) : null;
  }
  cache(key: string, value: unknown) {
    this.db
      .prepare("INSERT OR REPLACE INTO projections VALUES(?,?,?)")
      .run(key, LEDGER_PARSER_VERSION, json(value));
  }
  integrity() {
    if (this.db.prepare("PRAGMA quick_check").get()?.quick_check !== "ok") {
      throw new Error("SQLite 完整性檢查失敗；未刪除資料。");
    }
  }
  backup() {
    const directory = join(dirname(this.path), "backups");
    privateLedgerDirectory(directory);
    const target = join(directory, `${randomUUID()}.sqlite`);
    privateFile(target, true);
    // VACUUM INTO 包含已提交 WAL；不複製尚在使用的主檔案。
    this.db.prepare("VACUUM INTO ?").run(target);
    const check = new DatabaseSync(target, { readOnly: true });
    try {
      if (check.prepare("PRAGMA quick_check").get()?.quick_check !== "ok") {
        throw new Error("備份驗證失敗。");
      }
    } finally {
      check.close();
    }
    privateFile(target, false);
    return target;
  }
  leaseMaintenance(owner: string) {
    this.transaction(() => {
      this.db
        .prepare("DELETE FROM ledger_maintenance WHERE expires_at<=?")
        .run(Date.now());
      this.db
        .prepare("INSERT INTO ledger_maintenance VALUES(1,?,?)")
        .run(owner, Date.now() + 120000);
    });
  }
  releaseMaintenance(owner: string) {
    this.db.prepare("DELETE FROM ledger_maintenance WHERE owner=?").run(owner);
  }
  capacity(writing = true) {
    if (
      writing &&
      this.db
        .prepare("SELECT 1 FROM ledger_maintenance WHERE expires_at>?")
        .get(Date.now())
    ) {
      throw new Error("帳本壓縮中；操作未派送。");
    }
    privateFile(this.path, false);
    privateFile(`${this.path}-wal`, false);
    privateFile(`${this.path}-shm`, false);
    if (
      writing &&
      Number(this.db.prepare("SELECT COUNT(*) n FROM events").get()?.n) >=
        MAX_EVENTS
    ) {
      throw new Error("記帳超過事件上限；請先封存。");
    }
    if (realpathSync(dirname(this.path)) !== dirname(this.path)) {
      throw new Error("記帳目錄已改變。");
    }
  }
  close() {
    if (!this.closed) {
      this.db.close();
      this.closed = true;
    }
  }
}
