import { randomUUID } from "node:crypto";
import {
  chmodSync,
  constants,
  copyFileSync,
  existsSync,
  linkSync,
  mkdirSync,
  readFileSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, test, vi } from "vitest";
import { ledgerWatch } from "../src/ledger-channel.js";
import { ledgerStatus } from "../src/ledger-query.js";
import { LedgerRuntime } from "../src/ledger-runtime.js";
import { LedgerStore } from "../src/ledger-store.js";
import { LEDGER_PARSER_VERSION } from "../src/ledger-types.js";
import { ledgerHarness, skillText } from "./fixtures/ledger.js";
import { message } from "./fixtures/workflow.js";

const open: ReturnType<typeof ledgerHarness>[] = [];
const setup = (install = false) => {
  const h = ledgerHarness();
  open.push(h);
  if (install) {
    h.install();
  }
  return h;
};
afterEach(() => {
  vi.restoreAllMocks();
  for (const h of open.splice(0)) {
    h.close();
  }
});

test("SQLite schema v1、WAL、私有 DB 與 account 隔離；關閉冪等", () => {
  const h = setup();
  h.seed();
  const db = new DatabaseSync(h.store.path);
  try {
    expect(db.prepare("PRAGMA user_version").get()?.user_version).toBe(1);
    expect(db.prepare("PRAGMA journal_mode").get()?.journal_mode).toBe("wal");
    expect(
      db
        .prepare("SELECT name FROM sqlite_master WHERE type='table'")
        .all()
        .map((r) => r.name),
    ).toEqual(
      expect.arrayContaining([
        "operations",
        "observations",
        "operation_observations",
        "facts",
        "contexts",
        "projections",
      ]),
    );
  } finally {
    db.close();
  }
  expect(h.store.path).toBe(join(h.directory, "test.sqlite"));
  expect(statSync(h.directory).mode & 0o777).toBe(0o700);
  for (const path of [
    h.store.path,
    `${h.store.path}-wal`,
    `${h.store.path}-shm`,
  ]) {
    if (existsSync(path)) {
      expect(statSync(path).mode & 0o777).toBe(0o600);
    }
  }
  const other = new LedgerStore(join(h.directory, "other.sqlite"), "other");
  try {
    expect(other.read([]).observations).toEqual([]);
    expect(other.path).not.toBe(h.store.path);
  } finally {
    other.close();
    other.close();
  }
});

test.each(["../escape", "", "x/y", "x;DROP", "a".repeat(65)])(
  "帳號命名空間拒絕 %j",
  (name) => {
    const h = setup();
    expect(() => new LedgerStore(h.store.path, name)).toThrow(/命名空間/u);
  },
);

test("拒絕相對路徑、目錄 symlink 及過寬權限，不 chmod 舊目錄", () => {
  const h = setup();
  expect(() => new LedgerStore("relative.sqlite", "test")).toThrow(/絕對路徑/u);
  symlinkSync(h.directory, join(h.directory, "sym"));
  expect(
    () => new LedgerStore(join(h.directory, "sym", "nested.sqlite"), "nested"),
  ).toThrow(/symlink/u);
  const wide = join(h.directory, "wide");
  mkdirSync(wide, { mode: 0o700 });
  chmodSync(wide, 0o755);
  expect(() => new LedgerStore(join(wide, "test.sqlite"), "test")).toThrow(
    /0700/u,
  );
  expect(statSync(wide).mode & 0o777).toBe(0o755);
});

test.each(["", "-wal", "-shm"])(
  "扁平目錄拒絕 DB%s 的 symlink、hardlink 及過寬權限，不更動舊檔",
  (suffix) => {
    const h = setup();
    for (const kind of ["symlink", "hardlink", "wide"] as const) {
      const file = join(h.directory, `${kind}.sqlite`),
        target = `${file}${suffix}`;
      if (kind === "hardlink") {
        linkSync(h.store.path, target);
      } else if (kind === "symlink") {
        symlinkSync(h.store.path, target);
      } else {
        writeFileSync(target, "保留", { mode: 0o600 });
        chmodSync(target, 0o644);
      }
      expect(() => new LedgerStore(file, "test")).toThrow(/私有/u);
      if (kind === "wide") {
        expect(statSync(target).mode & 0o777).toBe(0o644);
        expect(readFileSync(target, "utf8")).toBe("保留");
      }
    }
  },
);

test("相同檔案的錯誤 owner 拒絕，原帳號資料與 account 不改變", () => {
  const h = setup();
  h.seed();
  const before = h.runtime.read();
  expect(() => new LedgerStore(h.store.path, "other")).toThrow(/命名空間不符/u);
  expect(h.runtime.read()).toEqual(before);
  const original = new LedgerStore(h.store.path, "test");
  try {
    expect(original.read(h.references())).toEqual(before);
  } finally {
    original.close();
  }
});

test("revision collision 與單批解析失敗整批 rollback；舊原文保留", () => {
  const h = setup();
  const m = h.seed();
  const context = h.runtime.read().contexts[0];
  if (!context) {
    throw new Error("缺 context");
  }
  expect(() =>
    h.store.observe(
      context.id,
      null,
      [message(2, "新原文"), { ...m, text: "revision 相同但內容更改" }],
      "watch",
    ),
  ).toThrow(/矛盾/u);
  expect(h.store.trace(2)).toBeNull();
  expect(h.store.trace(1)?.message.text).toBe(m.text);
  h.store.integrity();
});

test("SQLite 備份包含已提交 WAL，還原與 parser 重建不接觸 transport", async () => {
  const h = setup(true);
  h.seed();
  await h.act("/skill 血怒亂斬");
  const before = h.projection(),
    refs = h.references(),
    backup = h.store.backup();
  const restoredRoot = join(h.directory, "restored");
  mkdirSync(restoredRoot, { mode: 0o700 });
  const restoredPath = join(restoredRoot, "test.sqlite");
  copyFileSync(backup, restoredPath, constants.COPYFILE_EXCL);
  const restored = new LedgerStore(restoredPath, "test");
  const runtime = new LedgerRuntime(restored, {
    session: () => "restored",
    references: () => refs,
    publish: () => {
      throw new Error("不應發布");
    },
  });
  try {
    const old = new DatabaseSync(restored.path);
    old
      .prepare(
        "INSERT INTO facts SELECT observation_id,0,? FROM facts WHERE parser_version=?",
      )
      .run("[]", LEDGER_PARSER_VERSION);
    old
      .prepare("DELETE FROM facts WHERE parser_version=?")
      .run(LEDGER_PARSER_VERSION);
    old.close();
    restored.reparse();
    expect(runtime.read().observations).toEqual(h.runtime.read().observations);
    expect(restored.trace(1)?.versions.map((v) => v.parserVersion)).toEqual([
      0,
      LEDGER_PARSER_VERSION,
    ]);
    const { projectLedger } = await import("../src/ledger-projection.js");
    expect(projectLedger(runtime.read())).toEqual(before);
    expect(h.bot.send).toHaveBeenCalledOnce();
  } finally {
    runtime.close();
  }
});

test("未知版本、非空 v0 與損壞資料庫均不刪除或初始化", () => {
  const h = setup();
  for (const [name, sql] of [
    ["future", "PRAGMA user_version=999"],
    ["legacy", "CREATE TABLE old_data(x); INSERT INTO old_data VALUES(1)"],
  ] as const) {
    const file = join(h.directory, `${name}.sqlite`);
    writeFileSync(file, "", { mode: 0o600 });
    const db = new DatabaseSync(file);
    db.exec(sql);
    db.close();
    const before = readFileSync(file);
    expect(() => new LedgerStore(file, name)).toThrow();
    expect(readFileSync(file)).toEqual(before);
  }
  const file = join(h.directory, "broken.sqlite");
  writeFileSync(file, "not SQLite", { mode: 0o600 });
  expect(() => new LedgerStore(file, "broken")).toThrow();
  expect(readFileSync(file, "utf8")).toBe("not SQLite");
});

test("多連線的寫入鎖有有限逾時；送出前落盤失敗不派送，history 仍可用", async () => {
  const h = setup(true);
  h.seed();
  const lock = new DatabaseSync(h.store.path);
  lock.exec("BEGIN IMMEDIATE");
  const started = performance.now();
  try {
    await expect(h.act("/skill 血怒亂斬")).rejects.toThrow(/not dispatched/u);
    expect(performance.now() - started).toBeLessThan(4000);
    expect(h.factory).not.toHaveBeenCalled();
  } finally {
    lock.exec("ROLLBACK");
    lock.close();
  }
  expect(await h.game.history()).toHaveLength(1);
  expect(h.bot.send).not.toHaveBeenCalled();
});

test("送出後寫入失敗保留工具回覆並標帳本不完整，不重送", async () => {
  const h = setup(true);
  h.seed();
  const observe = h.store.observe.bind(h.store);
  vi.spyOn(h.store, "observe").mockImplementation(
    (context, operation, messages, phase, at) => {
      if (phase === "after") {
        throw new Error("磁碟已滿");
      }
      return observe(context, operation, messages, phase, at);
    },
  );
  const result = await h.act("/skill 血怒亂斬");
  expect(result.messages[0].text).toBe(skillText());
  expect(result.accounting).toMatchObject({ complete: false, mpAfter: null });
  await expect(h.act("/skill 血怒亂斬")).rejects.toThrow(/not dispatched/u);
  expect(await h.game.history()).toHaveLength(3);
  expect(h.bot.send).toHaveBeenCalledOnce();
});

test("送出前觀測寫入失敗及分支引用失敗都不發訊息", async () => {
  const h = setup(true);
  h.seed();
  vi.spyOn(h.store, "observe").mockImplementationOnce(() => {
    throw new Error("觀測失敗");
  });
  await expect(h.act("/skill 血怒亂斬")).rejects.toThrow(/not dispatched/u);
  expect(h.bot.send).not.toHaveBeenCalled();
  expect(h.projection().operations.at(-1)?.state).toBe("not_dispatched");
});

test.each([false, true])(
  "崩潰在 dispatch %s 時保持 unresolved，不宣稱遠端 exactly-once",
  (dispatched) => {
    const h = setup();
    h.seed();
    const ticket = h.runtime.begin("command", "/skill 血怒亂斬");
    ticket.observe(h.messages, "before");
    if (dispatched) {
      ticket.dispatch();
    }
    const fresh = new LedgerRuntime(h.store, {
      session: () => randomUUID(),
      references: () => h.references(),
      publish: () => {},
    });
    expect(fresh.read().operations).toHaveLength(1);
    expect(h.projection().operations[0].state).toBe("unresolved");
    expect(h.factory).not.toHaveBeenCalled();
    // fresh 與 h 共用連線，測試結束由 h 關閉。
  },
);

test("取消或 transport 送達結果不明不自動重送；取消後 history 不被阻斷", async () => {
  const h = setup(true);
  h.seed();
  vi.mocked(h.bot.send).mockRejectedValueOnce(new Error("連線在送出後斷開"));
  await expect(h.act("/skill 血怒亂斬")).rejects.toThrow(/outcome is unknown/u);
  expect(h.projection().operations.at(-1)?.state).toBe("unresolved");
  await h.game.history();
  expect(h.bot.send).toHaveBeenCalledOnce();
});

test("status 讀取失敗回傳未知與診斷，不洩漏底層錯誤或假報零餘額", () => {
  const h = setup();
  h.seed();
  vi.spyOn(h.runtime, "read").mockImplementation(() => {
    throw new Error("private database path");
  });
  const status = ledgerStatus(h.runtime, "測試熊");
  expect(status.resources.mp).toEqual({
    value: null,
    basis: "unknown",
    source: null,
  });
  expect(status.totals.mpSpent).toBeNull();
  expect(status.operationalEligibility).toBe(false);
  expect(status.diagnostics.join(" ")).toMatch(/讀取失敗/u);
  expect(JSON.stringify(status)).not.toContain("private database path");
});

test("事件達上限仍可唯讀診斷與備份，但不再派送操作", async () => {
  const h = setup(true);
  h.seed();
  const context = h.runtime.read().contexts[0];
  const db = new DatabaseSync(h.store.path);
  try {
    const count = Number(db.prepare("SELECT COUNT(*) n FROM events").get()?.n);
    db.prepare(`WITH RECURSIVE seq(n) AS (
      SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n < ?
    ) INSERT INTO events(context_id,operation_id,at,kind,data)
      SELECT ?,NULL,0,'metric','{}' FROM seq`).run(199_999 - count, context.id);
  } finally {
    db.close();
  }
  expect(h.store.event(context.id, null, "metric", {})).toBe(200_000);
  const status = ledgerStatus(h.runtime, "測試熊");
  expect(status.resources.mp.value).toBeNull();
  expect(h.runtime.read().observations).toHaveLength(1);
  expect(status.diagnostics.join(" ")).toMatch(/事件上限/u);
  expect(h.runtime.read().events.length).toBeGreaterThan(0);
  expect(() => h.store.capacity()).toThrow(/事件上限/u);
  expect(() => h.store.event(context.id, null, "metric", {})).toThrow(
    /事件上限/u,
  );
  expect(() =>
    h.store.observe(context.id, null, [message(99, "超限觀測")], "watch"),
  ).toThrow(/事件上限/u);
  expect(h.store.trace(2)).toBeNull();
  expect(existsSync(h.store.backup())).toBe(true);
  await expect(h.act("/skill 血怒亂斬")).rejects.toThrow(/not dispatched/u);
  expect(await h.game.history()).toHaveLength(1);
  expect(h.bot.send).not.toHaveBeenCalled();
});

test("watch 落盤失敗不 throw 中斷觀測，diagnostics 可見且後續 action 拒絕", async () => {
  const h = setup(true);
  h.seed();
  vi.spyOn(h.store, "observe").mockImplementationOnce(() => {
    throw new Error("鎖住");
  });
  expect(() => ledgerWatch([h.add("未解析")])).not.toThrow();
  expect(h.runtime.diagnostics()).toHaveLength(1);
  await expect(h.act("/skill 血怒亂斬")).rejects.toThrow(/not dispatched/u);
  expect(h.factory).not.toHaveBeenCalled();
});
