import {
  chmodSync,
  copyFileSync,
  existsSync,
  linkSync,
  mkdtempSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, test } from "vitest";
import { type RecordInput, RecordsStore } from "../src/records-store.js";

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) {
    cleanup();
  }
});
function setup() {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "bears-records-"));
  const path = join(root, "records.sqlite");
  const store = new RecordsStore(path);
  cleanups.push(() => {
    store.close();
    rmSync(root, { recursive: true, force: true });
  });
  return { root, path, store };
}
const note = (
  body = "星塔 狂戰熊 /skill 123456 🐻 %_ AND OR",
): RecordInput => ({
  kind: "note",
  title: "測試紀錄",
  body,
  characters: ["測試熊"],
  eventDate: "2026-10-27",
});

test("既有庫模式拒絕遺失／空檔，明確初始化原子拒絕既有庫", () => {
  const { root, store } = setup();
  const path = join(root, "new.sqlite");
  expect(() => new RecordsStore(path, { create: false })).toThrow(/不存在/u);
  expect(existsSync(path)).toBe(false);
  writeFileSync(path, "", { mode: 0o600 });
  expect(() => new RecordsStore(path, { create: false })).toThrow(
    /尚未初始化/u,
  );
  expect(() => RecordsStore.initialize(path)).toThrow();
  rmSync(path);
  const created = RecordsStore.initialize(path);
  const databaseId = created.databaseId;
  created.close();
  expect(() => RecordsStore.initialize(path)).toThrow();
  const reopened = new RecordsStore(path, { create: false });
  expect(reopened.databaseId).toBe(databaseId);
  reopened.close();
  expect(() => RecordsStore.initialize(store.path)).toThrow();
  store.append("still-usable", note());
  expect(store.status().records).toBe(1);
});

test("資料庫綁定的集合引用保留多筆與snapshot，拒絕跨庫及錯誤編碼", () => {
  const { store } = setup();
  const a = store.append("a", note()),
    b = store.append("b", note("另一筆"));
  const alias = "docs/notes/2026-10.md#重複";
  store.alias(alias, a.id);
  store.alias(alias, b.id);
  const reference = store.aliasReference(alias);
  const first = store.resolve(reference, 0, 1);
  expect(first.items).toHaveLength(1);
  expect(first.nextOffset).toBe(1);
  const next = store.resolve(reference, 1, 1, first.snapshot);
  expect(next.items).toHaveLength(1);
  expect(next.items[0].id).not.toBe(first.items[0].id);
  expect(next.nextOffset).toBeNull();
  const other = setup().store;
  expect(() => other.resolve(reference)).toThrow(/另一個資料庫/u);
  expect(() => store.resolve(`records:${store.databaseId}/alias/%ZZ`)).toThrow(
    /編碼無效/u,
  );
  expect(() => store.resolve(`records:${store.databaseId}/unknown`)).toThrow(
    /格式無效/u,
  );
  store.append("new", note());
  expect(() => store.resolve(reference, 1, 1, first.snapshot)).toThrow(/過期/u);
});

test("新增重送與修訂保留歷史；不同內容key及舊revision不覆寫", () => {
  const { store } = setup();
  const first = store.append("first", note());
  expect(store.append("first", note())).toMatchObject({
    id: first.id,
    revision: 1,
    replayed: true,
  });
  expect(() => store.append("first", note("不同內容"))).toThrow(/request key/u);
  const second = store.revise("second", first.id, 1, note("新版"));
  expect(second.revision).toBe(2);
  expect(store.read(first.id, 1).body).toContain("星塔");
  expect(store.read(first.id).body).toBe("新版");
  expect(() => store.revise("third", first.id, 1, note())).toThrow(/衝突/u);
  store.integrity();
});

test.each([
  "星塔",
  "狂戰熊",
  "測",
  "/skill",
  "123456",
  "🐻",
  "%_",
  "AND OR",
  "不存在",
  '" OR "',
])("字面查詢 %s，不將輸入當MATCH語法", (query) => {
  const { store } = setup();
  const body = note().body;
  store.append("one", note());
  expect(store.search({ query }).items).toHaveLength(
    body.toLowerCase().includes(query.toLowerCase()) ||
      "測試紀錄".includes(query)
      ? 1
      : 0,
  );
});

test("無trigram時仍以相同字面語意搜尋長短詞", () => {
  const { store } = setup();
  store.append("fallback", note());
  const before = store.search({ query: "狂戰熊" });
  Object.defineProperty(store, "trigram", { value: false });
  expect(store.search({ query: "狂戰熊" })).toEqual(before);
  expect(store.search({ query: "星塔" }).items).toHaveLength(1);
});

test("篩選、固定搜尋頁面與修訂失效游標；全文code point分頁可還原", () => {
  const { store } = setup();
  for (let n = 0; n < 15; n++) {
    store.append(String(n), note("🐻".repeat(15000)));
  }
  const first = store.search({
    kind: "note",
    character: "測試熊",
    from: "2026-10-01",
    limit: 3,
  });
  expect(first.items).toHaveLength(3);
  const second = store.search({
    kind: "note",
    character: "測試熊",
    from: "2026-10-01",
    limit: 3,
    cursor: first.nextCursor ?? undefined,
  });
  expect(second.items.some((i) => first.items.some((a) => a.id === i.id))).toBe(
    false,
  );
  const id = first.items[0].id;
  let text = "",
    offset: number | null = 0;
  while (offset !== null) {
    const page = store.get(id, 1, offset, 6000);
    text += page.body;
    offset = page.nextOffset;
  }
  expect(text).toBe("🐻".repeat(15000));
  expect(Buffer.byteLength(JSON.stringify(first))).toBeLessThan(8192);
  store.revise("new", id, 1, note("重寫"));
  expect(() =>
    store.search({
      kind: "note",
      character: "測試熊",
      from: "2026-10-01",
      limit: 3,
      cursor: first.nextCursor ?? undefined,
    }),
  ).toThrow(/游標/u);
  expect(store.search({ query: "重寫" }).items).toHaveLength(1);
});

test("別名保留整卷多筆入口，WAL備份還原與重開身分一致", () => {
  const { root, store } = setup();
  const a = store.append("a", note()),
    b = store.append("b", note());
  store.alias("docs/notes/old.md", a.id);
  store.alias("docs/notes/old.md", b.id);
  const page = store.resolve("docs/notes/old.md", 0, 1);
  expect(page.nextOffset).toBe(1);
  expect(
    store.resolve("docs/notes/old.md", 1, 1, page.snapshot).items,
  ).toHaveLength(1);
  const backup = store.backup(join(root, "backup"));
  const path = join(root, "restore.sqlite");
  copyFileSync(backup, path);
  const restored = new RecordsStore(path);
  try {
    expect(restored.status()).toEqual(store.status());
    expect(restored.read(a.id).body).toBe(note().body);
  } finally {
    restored.close();
  }
});

test("寫入中途失敗回滾record／request，inode替換後拒絕舊連線", () => {
  const { root, path, store } = setup();
  store.db.exec(
    "CREATE TRIGGER fail_revision BEFORE INSERT ON revisions BEGIN SELECT RAISE(ABORT,'synthetic write failure'); END;",
  );
  expect(() => store.append("failed", note())).toThrow(/write failure/u);
  expect(store.status().records).toBe(0);
  expect(store.db.prepare("SELECT COUNT(*) n FROM requests").get()?.n).toBe(0);
  store.db.exec("DROP TRIGGER fail_revision");
  store.append("success", note());
  const backup = store.backup(join(root, "backups"));
  renameSync(path, `${path}.old`);
  copyFileSync(backup, path);
  expect(() => store.append("wrong-file", note())).toThrow(/替換/u);
  expect(() => store.search()).toThrow(/替換/u);
});

test("多連線revision競爭與鎖定有限等待；transaction失敗不留半筆", () => {
  const { path, store } = setup();
  const other = new RecordsStore(path);
  try {
    const a = store.append("a", note());
    other.revise("b", a.id, 1, note("另一連線"));
    expect(() => store.revise("c", a.id, 1, note())).toThrow(/衝突/u);
    other.db.exec("BEGIN IMMEDIATE");
    const start = performance.now();
    expect(() => store.append("d", note())).toThrow();
    expect(performance.now() - start).toBeLessThan(3500);
    other.db.exec("ROLLBACK");
    expect(() =>
      store.transaction(() => {
        store.alias("alias", "missing");
      }),
    ).toThrow();
    expect(store.status().records).toBe(1);
  } finally {
    other.close();
  }
});

test("搜尋escaped文字仍在8KiB內；全文及alias續頁拒絕未固定版本", () => {
  const { store } = setup();
  for (let n = 0; n < 10; n++) {
    store.append(`escaped-${n}`, {
      kind: "note",
      title: String.fromCharCode(1).repeat(100),
      body: String.fromCharCode(2).repeat(100),
    });
  }
  expect(Buffer.byteLength(JSON.stringify(store.search()))).toBeLessThan(8192);
  const row = store.append("page", note());
  expect(() => store.get(row.id, undefined, 10, 10)).toThrow(/revision/u);
  expect(store.resolve(row.reference).items[0]).toMatchObject({
    id: row.id,
    revision: 1,
  });
  store.alias("whole", row.id);
  const page = store.resolve("whole", 0, 1);
  store.append("changed", note());
  expect(() => store.resolve("whole", 1, 1, page.snapshot)).toThrow(/過期/u);
  expect(() => store.resolve("whole", 1, 1)).toThrow(/snapshot/u);
});

test("拒絕不安全權限、非空未知schema與損壞，不刪原檔", () => {
  const { root, path } = setup();
  const symlink = join(root, "symlink.sqlite"),
    hardlink = join(root, "hardlink.sqlite");
  symlinkSync(path, symlink);
  linkSync(path, hardlink);
  expect(() => new RecordsStore(symlink)).toThrow(/私有/u);
  expect(() => new RecordsStore(hardlink)).toThrow(/私有/u);
  const wide = join(root, "wide.sqlite");
  writeFileSync(wide, "保留", { mode: 0o600 });
  chmodSync(wide, 0o644);
  expect(() => new RecordsStore(wide)).toThrow(/私有/u);
  const future = join(root, "future.sqlite");
  writeFileSync(future, "", { mode: 0o600 });
  const db = new DatabaseSync(future);
  db.exec("PRAGMA user_version=999;");
  db.close();
  expect(() => new RecordsStore(future)).toThrow(/schema/u);
  const broken = join(root, "broken.sqlite");
  writeFileSync(broken, "不是資料庫", { mode: 0o600 });
  expect(() => new RecordsStore(broken)).toThrow();
});
