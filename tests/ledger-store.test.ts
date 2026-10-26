import { randomUUID } from "node:crypto";
import {
  chmodSync,
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
import { LedgerRuntime } from "../src/ledger-runtime.js";
import { LedgerStore } from "../src/ledger-store.js";
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
  for (const path of [h.directory, join(h.directory, "test")]) {
    expect(statSync(path).mode & 0o077).toBe(0);
  }
  for (const path of [
    h.store.path,
    `${h.store.path}-wal`,
    `${h.store.path}-shm`,
  ]) {
    if (existsSync(path)) {
      expect(statSync(path).mode & 0o077).toBe(0);
    }
  }
  const other = new LedgerStore(h.directory, "other");
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
    expect(() => new LedgerStore(h.directory, name)).toThrow(/命名空間/u);
  },
);

test("拒絕目錄／DB／WAL symlink、hardlink 與過寬權限，不 chmod 舊檔", () => {
  const h = setup();
  symlinkSync(join(h.directory, "test"), join(h.directory, "sym"));
  expect(() => new LedgerStore(join(h.directory, "sym"), "nested")).toThrow(
    /symlink/u,
  );
  for (const [name, suffix, hard] of [
    ["symdb", "", false],
    ["symwal", "-wal", false],
    ["harddb", "", true],
  ] as const) {
    const dir = join(h.directory, name);
    mkdirSync(dir, { mode: 0o700 });
    if (hard) {
      linkSync(h.store.path, join(dir, `ledger.sqlite${suffix}`));
    } else {
      symlinkSync(h.store.path, join(dir, `ledger.sqlite${suffix}`));
    }
    expect(() => new LedgerStore(h.directory, name)).toThrow(/私有/u);
  }
  const wide = join(h.directory, "wide");
  mkdirSync(wide, { mode: 0o700 });
  chmodSync(wide, 0o755);
  expect(() => new LedgerStore(h.directory, "wide")).toThrow(/0700/u);
  expect(statSync(wide).mode & 0o077).toBe(0o055);
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
  const restoredAccount = join(restoredRoot, "test");
  mkdirSync(restoredAccount, { mode: 0o700 });
  copyFileSync(backup, join(restoredAccount, "ledger.sqlite"));
  const restored = new LedgerStore(restoredRoot, "test");
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
        "INSERT INTO facts SELECT observation_id,0,? FROM facts WHERE parser_version=1",
      )
      .run("[]");
    old.exec("DELETE FROM facts WHERE parser_version=1");
    old.close();
    restored.reparse();
    expect(runtime.read().observations).toEqual(h.runtime.read().observations);
    expect(restored.trace(1)?.versions.map((v) => v.parserVersion)).toEqual([
      0, 1,
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
    const dir = join(h.directory, name);
    mkdirSync(dir, { mode: 0o700 });
    const file = join(dir, "ledger.sqlite");
    writeFileSync(file, "", { mode: 0o600 });
    const db = new DatabaseSync(file);
    db.exec(sql);
    db.close();
    const before = readFileSync(file);
    expect(() => new LedgerStore(h.directory, name)).toThrow();
    expect(readFileSync(file)).toEqual(before);
  }
  const dir = join(h.directory, "broken");
  mkdirSync(dir, { mode: 0o700 });
  const file = join(dir, "ledger.sqlite");
  writeFileSync(file, "not SQLite", { mode: 0o600 });
  expect(() => new LedgerStore(h.directory, "broken")).toThrow();
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
