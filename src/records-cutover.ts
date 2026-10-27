import { posix } from "node:path";
import {
  RECORDS_CUTOVER_RULES,
  type RecordsRuleChange,
} from "./records-cutover-rules.js";
import { recordsHash } from "./records-data.js";
import {
  RECORDS_INPUTS,
  verifyStoredRecordsImport,
} from "./records-migrate.js";
import {
  auditRecordReferences,
  type RecordDocument,
} from "./records-reference-audit.js";
import type { RecordsStore } from "./records-store.js";

export interface CutoverEdit {
  start: number;
  end: number;
  before: string;
  after: string;
  reference?: string;
}
export interface CutoverDocument {
  path: string;
  sourceHash: string;
  rulesHash: string;
  resultHash: string;
  rules: CutoverEdit[];
  references: CutoverEdit[];
}
const excluded = (path: string) =>
  RECORDS_INPUTS.includes(path) || path.startsWith("docs/plans/");
function checkedDocuments(documents: RecordDocument[]) {
  const selected = documents.filter((d) => !excluded(d.path));
  if (
    selected.length > 512 ||
    selected.reduce((n, d) => n + Buffer.byteLength(d.text), 0) >
      16 * 1024 * 1024
  ) {
    throw new Error("切換預覽文件超出512份／16MiB限額；未改檔。");
  }
  const paths = new Set<string>();
  for (const d of selected) {
    if (
      !d.path.endsWith(".md") ||
      posix.isAbsolute(d.path) ||
      posix.normalize(d.path) !== d.path ||
      d.path.startsWith("../") ||
      /[\0\\]/u.test(d.path) ||
      paths.has(d.path)
    ) {
      throw new Error("預覽文件須為唯一repository相對Markdown路徑。");
    }
    paths.add(d.path);
  }
  return selected.sort((a, b) => a.path.localeCompare(b.path));
}
function applyText(text: string, edits: CutoverEdit[]) {
  let at = 0,
    result = "";
  for (const edit of [...edits].sort((a, b) => a.start - b.start)) {
    if (
      !Number.isSafeInteger(edit.start) ||
      !Number.isSafeInteger(edit.end) ||
      edit.start < at ||
      edit.end < edit.start ||
      edit.end > text.length ||
      text.slice(edit.start, edit.end) !== edit.before
    ) {
      throw new Error("預覽位置重疊、來源變更或內容不符；未產生替換。");
    }
    result += text.slice(at, edit.start) + edit.after;
    at = edit.end;
  }
  return result + text.slice(at);
}
/** 只回傳記憶體字串；不寫檔、不表示D6已核定。兩階段位置各對應自己的原文。 */
export function renderCutoverDocument(
  document: RecordDocument,
  proposed: CutoverDocument,
) {
  if (
    document.path !== proposed.path ||
    recordsHash(document.text) !== proposed.sourceHash
  ) {
    throw new Error("切換預覽後文件已改變；未產生替換。");
  }
  const rules = applyText(document.text, proposed.rules);
  if (recordsHash(rules) !== proposed.rulesHash) {
    throw new Error("規則預覽hash不符。");
  }
  const result = applyText(rules, proposed.references);
  if (recordsHash(result) !== proposed.resultHash) {
    throw new Error("引用預覽hash不符。");
  }
  return result;
}
/** 來源／庫身分綁定的純預覽，不掃目錄、改檔、刪來源或提供apply捷徑。 */
export function previewRecordsCutover(
  store: RecordsStore,
  manifest: string,
  documents: RecordDocument[],
  rules: RecordsRuleChange[] = RECORDS_CUTOVER_RULES,
) {
  const selected = checkedDocuments(documents);
  const reviews: { path: string; line?: number; reason: string }[] = [];
  store.status();
  store.db.exec("BEGIN");
  try {
    verifyStoredRecordsImport(store, manifest);
    const epoch = Number(
      store.db.prepare("SELECT epoch FROM records_meta WHERE id=1").get()
        ?.epoch,
    );
    const proposed: CutoverDocument[] = [];
    for (const rule of rules) {
      if (excluded(rule.path) || rule.path.startsWith("wiki/")) {
        throw new Error("切換規則不得修改來源、其他計畫或Wiki。");
      }
      if (!selected.some((d) => d.path === rule.path)) {
        reviews.push({
          path: rule.path,
          reason: "缺少有效規則文件；不猜測或建立新文件。",
        });
      }
    }
    let referencesConverted = 0,
      rulesConverted = 0;
    for (const document of selected) {
      const ruleEdits: CutoverEdit[] = [];
      for (const rule of rules.filter((r) => r.path === document.path)) {
        const start = document.text.indexOf(rule.oldText);
        if (
          !rule.oldText ||
          start < 0 ||
          document.text.indexOf(rule.oldText, start + rule.oldText.length) >= 0
        ) {
          reviews.push({
            path: document.path,
            reason: "有效規則原文缺漏或不唯一；須重新審查，不覆寫並行變更。",
          });
          continue;
        }
        ruleEdits.push({
          start,
          end: start + rule.oldText.length,
          before: rule.oldText,
          after: rule.newText,
        });
      }
      const afterRules = applyText(document.text, ruleEdits);
      const audit = auditRecordReferences(
        [{ path: document.path, text: afterRules }],
        store,
      );
      const referenceEdits: CutoverEdit[] = [];
      for (const finding of audit.findings) {
        if (
          document.path.startsWith("wiki/") ||
          !finding.alias ||
          ["missing", "needs_review"].includes(finding.status)
        ) {
          reviews.push({
            path: document.path,
            line: finding.line,
            reason: document.path.startsWith("wiki/")
              ? "Wiki不得加入私人紀錄引用。"
              : "引用無法定位；不編造ID。",
          });
          continue;
        }
        const resolved = store.resolve(finding.alias, 0, 2);
        const reference =
          finding.status === "multiple"
            ? store.aliasReference(finding.alias)
            : store.reference(resolved.items[0].id, 1);
        // 舊來源引用固定初始版本；集合保留歧義與snapshot分頁，不任選一筆。
        store.resolve(reference, 0, 1);
        const before = afterRules.slice(finding.start, finding.end);
        let after: string;
        if (
          finding.kind === "markdown" &&
          afterRules[finding.start - 1] !== "!"
        ) {
          const label = /^\[([^\]\n]*)\]\(/u.exec(before)?.[1];
          if (label === undefined) {
            throw new Error("Markdown引用缺少明確標籤。");
          }
          const title = afterRules
            .slice(finding.targetEnd, finding.end - 1)
            .replace(/^>/u, "")
            .trim();
          after = `${label}（\`${reference}\`${title ? `；${title}` : ""}）`;
        } else if (finding.kind === "bare" || finding.kind === "shorthand") {
          const quoted =
            afterRules[finding.start - 1] === "`" &&
            afterRules[finding.end] === "`";
          after = quoted ? reference : `\`${reference}\``;
        } else {
          reviews.push({
            path: document.path,
            line: finding.line,
            reason:
              "reference-style、HTML或圖片引用須人工審查呈現；不改成無法點閱的自訂網址。",
          });
          continue;
        }
        referenceEdits.push({
          start: finding.start,
          end: finding.end,
          before,
          after,
          reference,
        });
      }
      const result = applyText(afterRules, referenceEdits);
      rulesConverted += ruleEdits.length;
      referencesConverted += referenceEdits.length;
      proposed.push({
        path: document.path,
        sourceHash: recordsHash(document.text),
        rulesHash: recordsHash(afterRules),
        resultHash: recordsHash(result),
        rules: ruleEdits,
        references: referenceEdits,
      });
    }
    const content = {
      version: 1 as const,
      operationalEligibility: false as const,
      state:
        reviews.length > 0 ? ("needs_review" as const) : ("ready" as const),
      databaseId: store.databaseId,
      manifest,
      epoch,
      rulesConverted,
      referencesConverted,
      documents: proposed,
      reviews,
    };
    return {
      ...content,
      snapshot: recordsHash(JSON.stringify(content)),
      note: "僅候選差異，未改檔、刪來源或reload；依建議契約，不等於D1–D6核定。暫存庫引用不能當正式庫ID；套用前須停止相關寫入並重做預覽。",
    };
  } finally {
    store.db.exec("ROLLBACK");
  }
}
