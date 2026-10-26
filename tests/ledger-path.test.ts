import { randomUUID } from "node:crypto";
import {
  chmodSync,
  constants,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  symlinkSync,
} from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, test } from "vitest";
import { projectLedger } from "../src/ledger-projection.js";
import { LedgerStore } from "../src/ledger-store.js";
import { LEDGER_PARSER_VERSION } from "../src/ledger-types.js";
import { ledgerHarness } from "./fixtures/ledger.js";

const open: ReturnType<typeof ledgerHarness>[] = [];
afterEach(() => {
  for (const h of open.splice(0)) {
    h.close();
  }
});

test("合成舊 ID 庫含最後已提交 WAL：離線備份切換、重開與重建不遺失身分或分支資料", async () => {
  const id = "9007199254740993",
    account = `telegram-${id}`;
  const h = ledgerHarness(
    account,
    join("old", "by-telegram-id", account, "ledger.sqlite"),
  );
  open.push(h);
  h.install();
  h.seed();
  const branch = h.references();
  const writer = new DatabaseSync(h.store.path);
  try {
    writer.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    await h.act("/skill 血怒亂斬");
    // 模擬崩潰前已落盤但送達不明的操作；不呼叫 transport。
    const ticket = h.runtime.begin("command", "/skill 血怒亂斬");
    ticket.observe(h.messages, "before");
    ticket.dispatch();
    const source = randomUUID();
    h.store.original(h.messages, source);
    const exportKey = "checkpoint_export:synthetic",
      exportOwner = { hash: "synthetic-owner-hash" };
    h.store.cache(exportKey, exportOwner);
    h.store.cache("resource-projection", { mp: null });
    const refs = h.references(),
      data = h.runtime.read(),
      projection = projectLedger(data),
      branchData = h.store.read(branch),
      branchProjection = projectLedger(branchData),
      trace = h.store.trace(1);
    expect(
      projection.operations.some(
        (operation) => operation.state === "unresolved",
      ),
    ).toBe(true);
    expect(branchData.externalEvents).toBeGreaterThan(0);
    expect(statSync(`${h.store.path}-wal`).size).toBeGreaterThan(32);
    const backup = h.store.backup();
    expect(statSync(backup).mode & 0o777).toBe(0o600);
    expect(
      statSync(join(h.directory, "old", "by-telegram-id", account, "backups"))
        .mode & 0o777,
    ).toBe(0o700);
    // 備份包含最後的 committed WAL；正式切換仍須先停止所有使用者程序。
    writer.close();
    h.runtime.close();
    expect(existsSync(h.store.path)).toBe(true);
    const root = join(h.directory, "new", "bear-of-bears"),
      path = join(root, `${id}.sqlite`);
    mkdirSync(root, { recursive: true, mode: 0o700 });
    copyFileSync(backup, path, constants.COPYFILE_EXCL);
    chmodSync(path, 0o600);
    const bytes = readFileSync(path);
    expect(() => copyFileSync(backup, path, constants.COPYFILE_EXCL)).toThrow();
    expect(readFileSync(path)).toEqual(bytes);
    expect(existsSync(`${path}-wal`)).toBe(false);
    expect(existsSync(`${path}-shm`)).toBe(false);
    const restored = new LedgerStore(path, account);
    try {
      expect(restored.account).toBe(account);
      expect(restored.read(refs)).toEqual(data);
      expect(restored.read(branch)).toEqual(branchData);
      expect(restored.trace(1)).toEqual(trace);
      expect(restored.cached(exportKey)).toEqual(exportOwner);
      const db = new DatabaseSync(path);
      try {
        expect(db.prepare("PRAGMA user_version").get()?.user_version).toBe(1);
        expect(
          db.prepare("SELECT account FROM ledger_meta").get()?.account,
        ).toBe(account);
        db.prepare(
          "INSERT INTO facts SELECT observation_id,0,? FROM facts WHERE parser_version=?",
        ).run("[]", LEDGER_PARSER_VERSION);
        db.prepare("DELETE FROM facts WHERE parser_version=?").run(
          LEDGER_PARSER_VERSION,
        );
      } finally {
        db.close();
      }
      restored.reparse();
      expect(restored.read(refs)).toEqual(data);
      expect(projectLedger(restored.read(refs))).toEqual(projection);
      expect(projectLedger(restored.read(branch))).toEqual(branchProjection);
      expect(restored.trace(1)?.originalSourceId).toBe(source);
      expect(restored.trace(1)?.versions.map((v) => v.parserVersion)).toEqual([
        0,
        LEDGER_PARSER_VERSION,
      ]);
      expect(restored.cached(exportKey)).toEqual(exportOwner);
      expect(restored.cached("resource-projection")).toBeNull();
      restored.integrity();
    } finally {
      restored.close();
    }
    const reopened = new LedgerStore(path, account);
    try {
      expect(reopened.read(refs)).toEqual(data);
      expect(reopened.cached(exportKey)).toEqual(exportOwner);
      expect(projectLedger(reopened.read(branch))).toEqual(branchProjection);
    } finally {
      reopened.close();
    }
    expect(h.bot.send).toHaveBeenCalledOnce();
    expect(h.references()).toEqual(refs);
  } finally {
    if (writer.isOpen) {
      writer.close();
    }
  }
});

test("扁平根目錄的備份目錄含 symlink 時停止，原庫不變", () => {
  const h = ledgerHarness();
  open.push(h);
  h.seed();
  const before = h.runtime.read();
  symlinkSync(h.directory, join(h.directory, "backups"));
  expect(() => h.store.backup()).toThrow(/symlink/u);
  expect(h.runtime.read()).toEqual(before);
  expect(h.bot.send).not.toHaveBeenCalled();
});
