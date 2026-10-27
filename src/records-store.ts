import { randomUUID } from "node:crypto";
import { closeSync, lstatSync, openSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { privateLedgerDirectory } from "./ledger-store.js";
import {
  privateRecordsFile,
  type RecordInput,
  type RecordRevision,
  type RecordsQuery,
  recordsHash,
  validateRecord,
} from "./records-data.js";
import { searchRecords } from "./records-search.js";

export type {
  RecordInput,
  RecordRevision,
  RecordsQuery,
} from "./records-data.js";
export { recordsHash } from "./records-data.js";

const parse = <T>(value: unknown): T => JSON.parse(String(value)) as T;

/** 人工敘述紀錄，與遊戲觀測帳本及操作資格完全分離。 */
export class RecordsStore {
  readonly db: DatabaseSync;
  readonly databaseId: string;
  readonly trigram: boolean;
  private closed = false;
  private depth = 0;
  private readonly fileIdentity: string;
  /** 僅由明確初始化／離線匯入允許建立 schema；runtime 不自建空庫。 */
  constructor(
    readonly path: string,
    { create = true } = {},
  ) {
    if (!isAbsolute(path)) {
      throw new Error("紀錄庫須使用絕對路徑。");
    }
    if (!create) {
      try {
        lstatSync(path);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          throw new Error(
            "紀錄庫不存在；未建立空庫。請先復原、離線遷移或明確初始化。",
          );
        }
        throw error;
      }
    }
    privateLedgerDirectory(dirname(path));
    for (const suffix of ["", "-wal", "-shm"]) {
      privateRecordsFile(path + suffix, create && suffix === "");
    }
    const stat = lstatSync(path, { bigint: true });
    this.fileIdentity = `${stat.dev}:${stat.ino}`;
    this.db = new DatabaseSync(path);
    try {
      this.check();
      this.db.exec("PRAGMA busy_timeout=1000; PRAGMA foreign_keys=ON;");
      const version = Number(
        this.db.prepare("PRAGMA user_version").get()?.user_version,
      );
      if (version === 0) {
        if (!create) {
          throw new Error("紀錄庫尚未初始化；不將空檔重建成新資料。");
        }
        if (
          this.db
            .prepare("SELECT name FROM sqlite_master WHERE type='table'")
            .all().length > 0
        ) {
          throw new Error("拒絕初始化非空未知紀錄庫。");
        }
        this.transaction(() => {
          this.db.exec(`CREATE TABLE records_meta(id INTEGER PRIMARY KEY CHECK(id=1), database_id TEXT NOT NULL, epoch INTEGER NOT NULL);
            CREATE TABLE records(id TEXT PRIMARY KEY, revision INTEGER NOT NULL);
            CREATE TABLE revisions(record_id TEXT NOT NULL REFERENCES records(id), revision INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY(record_id,revision));
            CREATE TABLE requests(key TEXT PRIMARY KEY, hash TEXT NOT NULL, record_id TEXT NOT NULL REFERENCES records(id), revision INTEGER NOT NULL);
            CREATE TABLE aliases(alias TEXT NOT NULL, record_id TEXT NOT NULL REFERENCES records(id), PRIMARY KEY(alias,record_id));
            CREATE TABLE imports(id TEXT PRIMARY KEY, manifest TEXT NOT NULL);
            CREATE TABLE import_parts(import_id TEXT NOT NULL REFERENCES imports(id), path TEXT NOT NULL, ordinal INTEGER NOT NULL, record_id TEXT NOT NULL REFERENCES records(id), PRIMARY KEY(import_id,path,ordinal));
            PRAGMA user_version=1;`);
          this.db
            .prepare("INSERT INTO records_meta VALUES(1,?,0)")
            .run(randomUUID());
        });
      } else if (version !== 1) {
        throw new Error("不支援的紀錄庫 schema；未修改原資料。");
      }
      this.databaseId = String(
        this.db.prepare("SELECT database_id FROM records_meta WHERE id=1").get()
          ?.database_id ?? "",
      );
      if (!/^[a-f0-9-]{36}$/u.test(this.databaseId)) {
        throw new Error("紀錄庫身分無效。");
      }
      this.db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;");
      this.integrity();
      const hadCurrent =
        this.db
          .prepare("SELECT 1 FROM sqlite_master WHERE name='records_current'")
          .get() !== undefined;
      this.db.exec(
        "CREATE TABLE IF NOT EXISTS records_current(record_id TEXT PRIMARY KEY REFERENCES records(id), search_text TEXT NOT NULL, kind TEXT NOT NULL, event_date TEXT, characters TEXT NOT NULL); CREATE INDEX IF NOT EXISTS records_current_date ON records_current(event_date DESC,record_id);",
      );
      let trigram = false;
      const hadIndex =
        this.db
          .prepare("SELECT name FROM sqlite_master WHERE name='records_fts'")
          .get() !== undefined;
      try {
        this.db.exec(
          "CREATE VIRTUAL TABLE IF NOT EXISTS records_fts USING fts5(record_id UNINDEXED, text, tokenize='trigram');",
        );
        trigram = true;
      } catch {
        /* 無 FTS5 時仍有相同語意的字面搜尋。 */
      }
      this.trigram = trigram;
      if (!hadCurrent || (trigram && !hadIndex)) {
        this.reindex();
      }
    } catch (error) {
      this.db.close();
      throw error;
    }
  }
  /** 使用者明確新建；原子拒絕任何既有檔案，不覆寫或重用未知庫。 */
  static initialize(path: string) {
    privateLedgerDirectory(dirname(path));
    closeSync(openSync(path, "wx", 0o600));
    return new RecordsStore(path);
  }
  transaction<T>(work: () => T): T {
    const nested = this.depth > 0,
      savepoint = `records_${this.depth}`;
    this.db.exec(nested ? `SAVEPOINT ${savepoint}` : "BEGIN IMMEDIATE");
    this.depth++;
    try {
      const result = work();
      this.db.exec(nested ? `RELEASE ${savepoint}` : "COMMIT");
      return result;
    } catch (error) {
      this.db.exec(
        nested ? `ROLLBACK TO ${savepoint}; RELEASE ${savepoint}` : "ROLLBACK",
      );
      throw error;
    } finally {
      this.depth--;
    }
  }
  private check() {
    const stat = lstatSync(this.path, { bigint: true });
    if (`${stat.dev}:${stat.ino}` !== this.fileIdentity) {
      throw new Error("紀錄庫檔案已被替換；拒絕使用舊連線。");
    }
    if (realpathSync(dirname(this.path)) !== dirname(this.path)) {
      throw new Error("紀錄庫目錄已改變。");
    }
    for (const suffix of ["", "-wal", "-shm"]) {
      privateRecordsFile(this.path + suffix);
    }
  }
  private epoch() {
    return Number(
      this.db.prepare("SELECT epoch FROM records_meta WHERE id=1").get()?.epoch,
    );
  }
  reference(id: string, revision: number) {
    return `records:${this.databaseId}/${id}@${revision}`;
  }
  read(id: string, revision?: number): RecordRevision {
    this.check();
    const row =
      revision === undefined
        ? this.db
            .prepare(
              "SELECT v.data FROM records r JOIN revisions v ON v.record_id=r.id AND v.revision=r.revision WHERE r.id=?",
            )
            .get(id)
        : this.db
            .prepare(
              "SELECT data FROM revisions WHERE record_id=? AND revision=?",
            )
            .get(id, revision);
    if (!row) {
      throw new Error("找不到紀錄或指定版本。");
    }
    return parse<RecordRevision>(row.data);
  }
  get(id: string, revision?: number, offset = 0, limit = 4000) {
    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 6000
    ) {
      throw new Error("全文分頁範圍無效。");
    }
    if (offset > 0 && revision === undefined) {
      throw new Error("全文續頁須指定首次回傳的revision。");
    }
    const row = this.read(id, revision),
      chars = Array.from(row.body);
    const end = Math.min(chars.length, offset + limit);
    const imported = this.db
      .prepare(
        "SELECT json_extract(i.manifest,'$.importedAt') imported_at FROM imports i JOIN import_parts p ON p.import_id=i.id WHERE p.record_id=? LIMIT 1",
      )
      .get(id)?.imported_at;
    return {
      ...row,
      importedAt:
        typeof imported === "number" &&
        Number.isSafeInteger(imported) &&
        imported >= 0
          ? imported
          : null,
      body: chars.slice(offset, end).join(""),
      offset,
      totalCodePoints: chars.length,
      nextOffset: end < chars.length ? end : null,
      reference: this.reference(id, row.revision),
      operationalEligibility: false as const,
      note: "歷史敘述資料，不是即時遊戲狀態或操作授權。",
    };
  }
  private writeIndex(row: RecordRevision) {
    this.db
      .prepare(
        "INSERT OR REPLACE INTO records_current VALUES(?,lower(?),?,?,?)",
      )
      .run(
        row.id,
        `${row.title}\n${row.body}`,
        row.kind,
        row.eventDate ?? null,
        JSON.stringify(row.characters ?? []),
      );
    if (!this.trigram) {
      return;
    }
    this.db.prepare("DELETE FROM records_fts WHERE record_id=?").run(row.id);
    this.db
      .prepare("INSERT INTO records_fts(record_id,text) VALUES(?,?)")
      .run(row.id, `${row.title}\n${row.body}`);
  }
  reindex() {
    this.transaction(() => {
      this.db.exec("DELETE FROM records_current;");
      if (this.trigram) {
        this.db.exec("DELETE FROM records_fts;");
      }
      for (const row of this.db
        .prepare(
          "SELECT v.data FROM records r JOIN revisions v ON v.record_id=r.id AND v.revision=r.revision",
        )
        .all()) {
        this.writeIndex(parse<RecordRevision>(row.data));
      }
    });
  }
  private mutate(
    key: string,
    input: RecordInput,
    id?: string,
    expectedRevision?: number,
  ) {
    if (!key || key.length > 200) {
      throw new Error("request key 無效。");
    }
    const normalized = validateRecord(input),
      hash = recordsHash(
        JSON.stringify({ input: normalized, id, expectedRevision }),
      );
    this.check();
    return this.transaction(() => {
      const old = this.db
        .prepare("SELECT * FROM requests WHERE key=?")
        .get(key);
      if (old) {
        if (old.hash !== hash) {
          throw new Error("request key 已用於不同內容。");
        }
        return this.receipt(String(old.record_id), Number(old.revision), true);
      }
      const previous = id ? this.read(id) : null;
      if (previous && previous.revision !== expectedRevision) {
        throw new Error("revision 衝突；未覆寫紀錄。");
      }
      const row: RecordRevision = {
        ...normalized,
        id: id ?? randomUUID(),
        revision: (previous?.revision ?? 0) + 1,
        createdAt: Date.now(),
      };
      this.db
        .prepare(
          "INSERT INTO records VALUES(?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision",
        )
        .run(row.id, row.revision);
      this.db
        .prepare("INSERT INTO revisions VALUES(?,?,?)")
        .run(row.id, row.revision, JSON.stringify(row));
      this.db
        .prepare("INSERT INTO requests VALUES(?,?,?,?)")
        .run(key, hash, row.id, row.revision);
      this.writeIndex(row);
      this.db.exec("UPDATE records_meta SET epoch=epoch+1 WHERE id=1");
      return this.receipt(row.id, row.revision, false);
    });
  }
  private receipt(id: string, revision: number, replayed: boolean) {
    return {
      id,
      revision,
      reference: this.reference(id, revision),
      replayed,
      operationalEligibility: false as const,
    };
  }
  append(key: string, input: RecordInput) {
    return this.mutate(key, input);
  }
  revise(
    key: string,
    id: string,
    expectedRevision: number,
    input: RecordInput,
  ) {
    return this.mutate(key, input, id, expectedRevision);
  }
  search(input: RecordsQuery = {}) {
    this.check();
    return searchRecords(
      this.db,
      {
        databaseId: this.databaseId,
        trigram: this.trigram,
        reference: (id, revision) => this.reference(id, revision),
      },
      input,
    );
  }
  alias(alias: string, id: string) {
    this.check();
    const result = this.db
      .prepare("INSERT OR IGNORE INTO aliases VALUES(?,?)")
      .run(alias, id);
    if (Number(result.changes) > 0) {
      this.db.exec("UPDATE records_meta SET epoch=epoch+1 WHERE id=1");
    }
  }
  aliasReference(alias: string) {
    this.check();
    const reference = `records:${this.databaseId}/alias/${encodeURIComponent(alias)}`;
    if (!alias || reference.length > 1000) {
      throw new Error("別名引用為空或超過工具上限。");
    }
    return reference;
  }
  resolve(alias: string, offset = 0, limit = 10, snapshot?: number) {
    this.check();
    const epoch = this.epoch();
    if (
      (offset > 0 && snapshot === undefined) ||
      (snapshot !== undefined && snapshot !== epoch)
    ) {
      throw new Error("別名續頁缺少snapshot或已過期。");
    }
    if (
      offset < 0 ||
      !Number.isSafeInteger(offset) ||
      limit < 1 ||
      limit > 10 ||
      !Number.isInteger(limit)
    ) {
      throw new Error("別名分頁無效。");
    }
    const reference =
      /^records:([a-f0-9-]{36})\/([a-f0-9-]{36})@([1-9]\d*)$/u.exec(alias);
    if (reference) {
      if (reference[1] !== this.databaseId) {
        throw new Error("紀錄引用屬於另一個資料庫。");
      }
      const row = this.read(reference[2], Number(reference[3]));
      return {
        items: offset === 0 ? [this.receipt(row.id, row.revision, false)] : [],
        nextOffset: null,
        snapshot: epoch,
        operationalEligibility: false as const,
      };
    }
    let lookupAlias = alias;
    const collection = /^records:([a-f0-9-]{36})\/alias\/(.+)$/u.exec(alias);
    if (collection) {
      if (collection[1] !== this.databaseId) {
        throw new Error("紀錄引用屬於另一個資料庫。");
      }
      try {
        lookupAlias = decodeURIComponent(collection[2]);
      } catch {
        throw new Error("紀錄別名引用編碼無效。");
      }
    } else if (alias.startsWith("records:")) {
      throw new Error("紀錄引用格式無效。");
    }
    const rows = this.db
      .prepare(
        "SELECT record_id FROM aliases WHERE alias=? ORDER BY record_id LIMIT ? OFFSET ?",
      )
      .all(lookupAlias, limit + 1, offset);
    return {
      items: rows
        .slice(0, limit)
        .map((r) =>
          this.receipt(
            String(r.record_id),
            this.read(String(r.record_id)).revision,
            false,
          ),
        ),
      nextOffset: rows.length > limit ? offset + limit : null,
      snapshot: epoch,
      operationalEligibility: false as const,
    };
  }
  integrity() {
    if (
      this.db.prepare("PRAGMA quick_check").get()?.quick_check !== "ok" ||
      this.db.prepare("PRAGMA foreign_key_check").all().length > 0
    ) {
      throw new Error("紀錄庫完整性檢查失敗。");
    }
  }
  backup(directory: string) {
    privateLedgerDirectory(directory);
    const target = join(directory, `${this.databaseId}-${randomUUID()}.sqlite`);
    privateRecordsFile(target, true);
    this.check();
    this.db.prepare("VACUUM INTO ?").run(target);
    const check = new DatabaseSync(target, { readOnly: true });
    try {
      if (check.prepare("PRAGMA quick_check").get()?.quick_check !== "ok") {
        throw new Error("紀錄庫備份驗證失敗。");
      }
    } finally {
      check.close();
    }
    return target;
  }
  status() {
    this.check();
    return {
      databaseId: this.databaseId,
      records: Number(
        this.db.prepare("SELECT COUNT(*) n FROM records").get()?.n,
      ),
      revisions: Number(
        this.db.prepare("SELECT COUNT(*) n FROM revisions").get()?.n,
      ),
      imports: Number(
        this.db.prepare("SELECT COUNT(*) n FROM imports").get()?.n,
      ),
      trigram: this.trigram,
      operationalEligibility: false as const,
    };
  }
  close() {
    if (!this.closed) {
      this.closed = true;
      this.db.close();
    }
  }
}
