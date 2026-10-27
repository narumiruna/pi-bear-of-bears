import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import {
  previewRecordsCutover,
  renderCutoverDocument,
} from "../src/records-cutover.js";
import {
  applyRecordsImport,
  previewRecordsImport,
} from "../src/records-migrate.js";
import { auditRecordReferences } from "../src/records-reference-audit.js";
import { RecordsStore } from "../src/records-store.js";

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const close of cleanups.splice(0).reverse()) {
    close();
  }
});
function setup() {
  const root = mkdtempSync(
    join(realpathSync(tmpdir()), "records-cutover-test-"),
  );
  const store = new RecordsStore(join(root, "records.sqlite"));
  cleanups.push(() => {
    store.close();
    rmSync(root, { recursive: true, force: true });
  });
  const sources = [
    {
      path: "docs/notes/2026-10.md",
      text: '# 前言\n<a id="unique"></a>\n## 2026-10-27 21:00 +0800：測試\n🐻歷史證據\n',
    },
  ];
  const plan = previewRecordsImport(sources);
  applyRecordsImport(store, plan, sources);
  return { store, plan };
}
test("預覽規則與唯一／整卷／時刻引用，不改原文或資料，文字引用可解析", () => {
  const { store, plan } = setup();
  const document = {
    path: "AGENTS.md",
    text: "🐻舊寫入規則。\n[原文](docs/notes/2026-10.md#unique)\n整卷 `docs/notes/2026-10.md`\n詳 NOTES21:00\n",
  };
  const original = document.text,
    before = store.status();
  const rules = [
    {
      path: "AGENTS.md",
      oldText: "舊寫入規則",
      newText: "以`records_append`新增，不擴張授權",
    },
  ];
  const preview = previewRecordsCutover(store, plan.id, [document], rules);
  expect(preview.reviews).toEqual([]);
  expect(preview.rulesConverted).toBe(1);
  expect(preview.referencesConverted).toBe(3);
  expect(document.text).toBe(original);
  expect(store.status()).toEqual(before);
  const rendered = renderCutoverDocument(document, preview.documents[0]);
  expect(rendered).toContain("records_append");
  expect(rendered).not.toContain("](docs/");
  expect(rendered).toContain(
    `/alias/${encodeURIComponent("docs/notes/2026-10.md")}`,
  );
  for (const e of preview.documents[0].references) {
    expect(store.resolve(e.reference ?? "").items.length).toBeGreaterThan(0);
  }
  expect(
    previewRecordsCutover(store, plan.id, [document], rules).snapshot,
  ).toBe(preview.snapshot);
});
test("精確URL位置不會選到同字標籤或title；轉換引用固定初始版本", () => {
  const { store, plan } = setup();
  const alias = "docs/notes/2026-10.md#unique";
  const document = {
    path: "README.md",
    text: `🐻[${alias}](${alias} "標題 ${alias}")`,
  };
  const finding = auditRecordReferences([document], store).findings[0];
  expect(document.text.slice(finding.targetStart, finding.targetEnd)).toBe(
    alias,
  );
  expect(finding.targetStart).toBe(document.text.indexOf("](") + 2);
  const current = store.resolve(alias).items[0];
  store.revise("changed", current.id, 1, {
    kind: "note",
    title: "修訂",
    body: "新版",
  });
  const preview = previewRecordsCutover(store, plan.id, [document], []);
  expect(preview.documents[0].references[0].reference).toBe(
    store.reference(current.id, 1),
  );
  const rendered = renderCutoverDocument(document, preview.documents[0]);
  expect(rendered).toContain(`@1\``);
  expect(rendered).toContain(`標題 ${alias}`);
  const another = previewRecordsCutover(store, plan.id, [document], []);
  store.append("unrelated", { kind: "log", title: "新增", body: "歷史" });
  expect(
    previewRecordsCutover(store, plan.id, [document], []).snapshot,
  ).not.toBe(another.snapshot);
});
test("缺來源、非唯一規則、HTML與reference-style及Wiki私人引用保留待審，不猜ID", () => {
  const { store, plan } = setup();
  const documents = [
    {
      path: "README.md",
      text: '[缺頁](docs/notes/2026-10.md#missing)\n<a href="docs/notes/2026-10.md#unique">來源</a>\n[x]: docs/notes/2026-10.md#unique\n舊規則 舊規則\n',
    },
    { path: "wiki/unsafe.md", text: "docs/notes/2026-10.md#unique" },
    { path: "docs/plans/other.md", text: "不讀此計畫" },
    { path: "docs/notes/2026-10.md", text: "不改來源" },
  ];
  const preview = previewRecordsCutover(store, plan.id, documents, [
    { path: "README.md", oldText: "舊規則", newText: "新規則" },
  ]);
  expect(preview.reviews).toHaveLength(5);
  expect(preview.documents).toHaveLength(2);
  expect(preview.referencesConverted).toBe(0);
  expect(preview.rulesConverted).toBe(0);
  for (const proposed of preview.documents) {
    const document = documents.find((d) => d.path === proposed.path);
    if (!document) {
      throw new Error("missing");
    }
    expect(renderCutoverDocument(document, proposed)).toBe(document.text);
  }
});
test("來源hash、位置、manifest或路徑不符拒絕；中斷後原庫仍可讀寫", () => {
  const { store, plan } = setup();
  const document = { path: "README.md", text: "docs/notes/2026-10.md#unique" };
  const preview = previewRecordsCutover(store, plan.id, [document], []);
  expect(() =>
    renderCutoverDocument(
      { ...document, text: `${document.text}變更` },
      preview.documents[0],
    ),
  ).toThrow(/已改變/u);
  const proposed = structuredClone(preview.documents[0]);
  proposed.references[0].start++;
  expect(() => renderCutoverDocument(document, proposed)).toThrow(/不符/u);
  expect(() => previewRecordsCutover(store, "wrong", [document], [])).toThrow(
    /manifest/u,
  );
  expect(() =>
    previewRecordsCutover(
      store,
      plan.id,
      [{ path: "../outside.md", text: "" }],
      [],
    ),
  ).toThrow(/相對/u);
  expect(() =>
    previewRecordsCutover(store, plan.id, [document, document], []),
  ).toThrow(/唯一/u);
  expect(() =>
    previewRecordsCutover(
      store,
      plan.id,
      Array.from({ length: 513 }, (_, n) => ({
        path: `docs/${n}.md`,
        text: "",
      })),
      [],
    ),
  ).toThrow(/限額/u);
  store.append("after-error", {
    kind: "log",
    title: "仍可寫入",
    body: "失敗沒有留下交易",
  });
});
