import { posix } from "node:path";
import { RECORDS_INPUTS, resolveRecordLink } from "./records-migrate.js";
import type { RecordsStore } from "./records-store.js";

export interface RecordDocument {
  path: string;
  text: string;
}
export interface RecordReferenceFinding {
  document: string;
  line: number;
  /** 原文件UTF-16位置，供純記憶體切換預覽使用；不是檔案寫入授權。 */
  start: number;
  end: number;
  targetStart: number;
  targetEnd: number;
  kind: "markdown" | "reference" | "html" | "bare" | "shorthand";
  text: string;
  alias: string | null;
  status: "resolved" | "multiple" | "missing" | "needs_review";
  reference: string | null;
}
/** 只稽核呼叫端明確提供的文件，不掃私人目錄，不修改原始內容或其他計畫。 */
export function auditRecordReferences(
  documents: RecordDocument[],
  store: RecordsStore,
) {
  const paths = new Set(RECORDS_INPUTS);
  const findings: RecordReferenceFinding[] = [];
  for (const document of documents) {
    if (document.path.startsWith("docs/plans/")) {
      continue;
    }
    const occupied: { start: number; end: number }[] = [];
    const inspect = (
      kind: RecordReferenceFinding["kind"],
      text: string,
      at: number,
      span: number,
      target: [number, number] = [at, at + span],
    ) => {
      if (occupied.some((r) => at >= r.start && at < r.end)) {
        return;
      }
      if (kind === "shorthand") {
        const resolved = store.resolve(text, 0, 2);
        findings.push({
          document: document.path,
          line: document.text.slice(0, at).split("\n").length,
          start: at,
          end: at + span,
          targetStart: target[0],
          targetEnd: target[1],
          kind,
          text,
          alias: resolved.items.length > 0 ? text : null,
          status:
            resolved.items.length > 0
              ? resolved.items.length === 1 && resolved.nextOffset === null
                ? "resolved"
                : "multiple"
              : "needs_review",
          reference:
            resolved.items.length === 1 && resolved.nextOffset === null
              ? resolved.items[0].reference
              : null,
        });
        return;
      }
      let decoded = text;
      try {
        decoded = decodeURI(text);
      } catch {
        /* 不猜錯誤編碼。 */
      }
      const raw = decoded.startsWith("docs/")
        ? { alias: posix.normalize(decoded) }
        : resolveRecordLink(document.path, decoded);
      if (
        typeof raw.alias !== "string" ||
        !paths.has(raw.alias.split("#", 1)[0])
      ) {
        return;
      }
      occupied.push({ start: at, end: at + span });
      const result = store.resolve(raw.alias, 0, 2);
      findings.push({
        document: document.path,
        line: document.text.slice(0, at).split("\n").length,
        start: at,
        end: at + span,
        targetStart: target[0],
        targetEnd: target[1],
        kind,
        text,
        alias: raw.alias,
        status:
          result.items.length === 0
            ? "missing"
            : result.items.length === 1 && result.nextOffset === null
              ? "resolved"
              : "multiple",
        reference:
          result.items.length === 1 && result.nextOffset === null
            ? result.items[0].reference
            : null,
      });
    };
    const captured = (
      kind: RecordReferenceFinding["kind"],
      match: RegExpExecArray,
    ) => {
      const target = match.indices?.[1];
      if (!target) {
        throw new Error("引用缺少精確位置；未產生切換猜測。");
      }
      inspect(kind, match[1], match.index, match[0].length, target);
    };
    for (const match of document.text.matchAll(
      /\[[^\]\n]*\]\(<?([^\s<>)]*)>?(?:\s+["'][^\n]*?["'])?\)/dgu,
    )) {
      captured("markdown", match);
    }
    for (const match of document.text.matchAll(
      /^\s*\[[^\]\n]+\]:\s*<?([^\s<>]+)>?/dgmu,
    )) {
      captured("reference", match);
    }
    for (const match of document.text.matchAll(
      /(?:href|src)=["']([^"']+)["']/dgu,
    )) {
      captured("html", match);
    }
    for (const match of document.text.matchAll(
      /(?:docs\/)?(?:notes|logs)\/[^\s`<>"'\])]+\.md(?:#[^\s`<>"'\])]+)?|(?:docs\/)?(?:NOTES|LOG)\.md(?:#[^\s`<>"'\])]+)?/gu,
    )) {
      inspect("bare", match[0], match.index, match[0].length);
    }
    for (const match of document.text.matchAll(
      /\b(?:NOTES|LOG)\d{1,2}:\d{2}\b/gu,
    )) {
      inspect("shorthand", match[0], match.index, match[0].length);
    }
  }
  return {
    documents: documents.length,
    findings,
    counts: Object.fromEntries(
      ["resolved", "multiple", "missing", "needs_review"].map((status) => [
        status,
        findings.filter((f) => f.status === status).length,
      ]),
    ),
    note: "整卷多筆、歷史簡稱與缺alias保留明確待處理；稽核不是正式切換放行。",
  };
}
