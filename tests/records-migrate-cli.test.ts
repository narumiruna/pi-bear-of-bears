import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { RECORDS_INPUTS } from "../src/records-migrate.js";
import { recordsMigrationCommand } from "../src/records-migrate-cli.js";
import { RecordsStore } from "../src/records-store.js";

const roots: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});
function setup() {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "records-cli-"));
  roots.push(root);
  for (const path of RECORDS_INPUTS) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(
      join(root, path),
      `# 紀錄\n<a id="same"></a>\n## 2026-10-27 21:00 +0800：測試\n${path} 狂戰熊與星塔。\n`,
    );
  }
  return {
    root,
    database: join(root, "runtime/records.sqlite"),
    backup: join(root, "secondary"),
  };
}
test("CLI preview不開庫；apply保護原檔、備份與重跑，原檔移除後仍能verify", () => {
  const h = setup(),
    preview = recordsMigrationCommand(["preview"], h.root);
  if (typeof preview.manifest !== "string") {
    throw new Error("missing");
  }
  expect(existsSync(h.database)).toBe(false);
  const first = recordsMigrationCommand(
    ["apply", h.database, preview.manifest, h.backup],
    h.root,
  );
  expect(first).toMatchObject({ verified: true, files: 8 });
  const second = recordsMigrationCommand(
    ["apply", h.database, preview.manifest, h.backup],
    h.root,
  );
  expect(second).toMatchObject({ verified: true, records: 16 });
  for (const path of RECORDS_INPUTS) {
    expect(existsSync(join(h.root, path))).toBe(true);
    unlinkSync(join(h.root, path));
  }
  expect(
    recordsMigrationCommand(["verify", h.database, preview.manifest], h.root),
  ).toMatchObject({ verified: true, records: 16 });
});
test("匯入中來源改變會回滾整批，不保留半套alias／record", () => {
  const h = setup(),
    preview = recordsMigrationCommand(["preview"], h.root);
  if (typeof preview.manifest !== "string") {
    throw new Error("missing");
  }
  const append = RecordsStore.prototype.append;
  let changed = false;
  vi.spyOn(RecordsStore.prototype, "append").mockImplementation(function (
    this: RecordsStore,
    key,
    input,
  ) {
    if (!changed) {
      changed = true;
      writeFileSync(join(h.root, "docs/NOTES.md"), "來源已變更");
    }
    return append.call(this, key, input);
  });
  expect(() =>
    recordsMigrationCommand(
      ["apply", h.database, preview.manifest, h.backup],
      h.root,
    ),
  ).toThrow(/回滾/u);
  const store = new RecordsStore(h.database);
  try {
    expect(store.status().records).toBe(0);
    expect(store.status().imports).toBe(0);
  } finally {
    store.close();
  }
});

test("錯誤hash、目的庫或缺第二份備份不刪來源、不覆寫其他庫", () => {
  const h = setup(),
    preview = recordsMigrationCommand(["preview"], h.root);
  if (typeof preview.manifest !== "string") {
    throw new Error("missing");
  }
  expect(() =>
    recordsMigrationCommand(["apply", h.database, "wrong", h.backup], h.root),
  ).toThrow();
  expect(() =>
    recordsMigrationCommand(["apply", h.database, preview.manifest], h.root),
  ).toThrow();
  expect(existsSync(h.database)).toBe(false);
  const store = new RecordsStore(h.database);
  store.append("existing", { kind: "note", title: "另一來源", body: "保留" });
  store.close();
  expect(() =>
    recordsMigrationCommand(
      ["apply", h.database, preview.manifest, h.backup],
      h.root,
    ),
  ).toThrow(/其他資料/u);
  expect(() =>
    recordsMigrationCommand(
      ["verify", join(h.root, "missing.sqlite"), preview.manifest],
      h.root,
    ),
  ).toThrow(/不存在|既有DB/u);
  const empty = join(h.root, "empty.sqlite");
  writeFileSync(empty, "", { mode: 0o600 });
  expect(() =>
    recordsMigrationCommand(["verify", empty, preview.manifest], h.root),
  ).toThrow(/尚未初始化/u);
  expect(lstatSync(empty).size).toBe(0);
  for (const path of RECORDS_INPUTS) {
    expect(existsSync(join(h.root, path))).toBe(true);
  }
});
