import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import {
  applyRecordsImport,
  previewRecordsImport,
} from "../src/records-migrate.js";
import { auditRecordReferences } from "../src/records-reference-audit.js";
import { RecordsStore } from "../src/records-store.js";

test("稽核inline／reference／HTML／裸路徑與舊簡稱，不任選整卷、不讀其他計畫", () => {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "records-audit-")),
    store = new RecordsStore(join(root, "records.sqlite"));
  try {
    const sources = [
      {
        path: "docs/notes/2026-10.md",
        text: '# 前言\n<a id="明示"></a>\n## 無日期\n本文\n',
      },
    ];
    applyRecordsImport(store, previewRecordsImport(sources), sources);
    const audit = auditRecordReferences(
      [
        {
          path: "docs/goals/sample.md",
          text: '[來源](../notes/2026-10.md#明示)\n[別名]: ../notes/2026-10.md#明示\n<a href="../notes/2026-10.md#%E6%98%8E%E7%A4%BA">來源</a>\ndocs/notes/2026-10.md\n[缺頁](../notes/2026-10.md#missing)\n詳 NOTES09:10\n',
        },
        {
          path: "docs/plans/unrelated.md",
          text: "[不讀](../notes/2026-10.md#missing)",
        },
      ],
      store,
    );
    expect(audit.findings.filter((f) => f.status === "resolved")).toHaveLength(
      3,
    );
    expect(audit.findings.filter((f) => f.kind === "shorthand")).toHaveLength(
      1,
    );
    expect(audit.findings.some((f) => f.status === "multiple")).toBe(true);
    expect(audit.findings.some((f) => f.status === "missing")).toBe(true);
    expect(audit.findings.some((f) => f.document.includes("unrelated"))).toBe(
      false,
    );
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});
