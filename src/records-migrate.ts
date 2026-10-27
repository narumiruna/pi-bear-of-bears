import { readFileSync } from "node:fs";
import { posix, resolve } from "node:path";
import type { RecordInput } from "./records-data.js";
import { recordsHash, validateRecord } from "./records-data.js";
import type { RecordsStore } from "./records-store.js";

export const RECORDS_INPUTS = [
  "docs/NOTES.md",
  "docs/LOG.md",
  "docs/notes/2026-10.md",
  "docs/notes/2026-09.md",
  "docs/notes/legacy.md",
  "docs/logs/2026-10.md",
  "docs/logs/2026-09.md",
  "docs/logs/legacy.md",
];
export interface RecordsSource {
  path: string;
  text: string;
}
export interface RecordsImportPlan {
  version: 2;
  id: string;
  files: {
    path: string;
    bytes: number;
    hash: string;
    parts: {
      ordinal: number;
      start: number;
      end: number;
      aliases: string[];
      record: RecordInput;
    }[];
  }[];
}
/** 按可定位的區塊切割，但原始文字不正規化；前言、空行與索引也保留。 */
export function previewRecordsImport(
  sources: RecordsSource[],
): RecordsImportPlan {
  if (new Set(sources.map((s) => s.path)).size !== sources.length) {
    throw new Error("重複匯入路徑。");
  }
  const files = sources.map((source) => {
    if (
      !/^(?:docs\/(?:NOTES|LOG)\.md|docs\/(?:notes|logs)\/[^/]+\.md)$/u.test(
        source.path,
      )
    ) {
      throw new Error("不支援的紀錄來源路徑。");
    }
    const lines = source.text.match(/[^\n]*\n|[^\n]+$/gu) ?? [];
    const boundaries = new Set<number>([0]);
    let at = 0,
      fence: { symbol: string; count: number } | null = null,
      pendingAnchor: number | null = null;
    const located: { at: number; alias: string }[] = [];
    const slugCounts = new Map<string, number>();
    for (const line of lines) {
      const mark = /^ {0,3}(`{3,}|~{3,})/u.exec(line);
      if (mark) {
        if (!fence) {
          fence = { symbol: mark[1][0], count: mark[1].length };
        } else if (
          mark[1][0] === fence.symbol &&
          mark[1].length >= fence.count
        ) {
          fence = null;
        }
      } else if (!fence) {
        const anchor =
          /^\s*<a\s+(?:id|name)=["']([^"']+)["']\s*><\/a>\s*$/u.exec(line);
        const heading = /^(#{1,6})\s+(.+?)\s*#*\s*$/u.exec(line.trimEnd());
        if (anchor) {
          pendingAnchor ??= at;
          boundaries.add(pendingAnchor);
          located.push({ at, alias: `${source.path}#${anchor[1]}` });
        } else if (heading) {
          if (heading[1].length <= 2 && pendingAnchor === null) {
            boundaries.add(at);
          }
          const slug = heading[2]
            .toLowerCase()
            .replace(/[^\p{L}\p{N}\s_-]/gu, "")
            .replace(/\s/gu, "-");
          const count = slugCounts.get(slug) ?? 0;
          slugCounts.set(slug, count + 1);
          located.push({
            at,
            alias: `${source.path}#${slug}${count ? `-${count}` : ""}`,
          });
          const time = /(?:^|\s)([0-2]?\d:[0-5]\d)(?:\s|$|[：:])/u.exec(
            heading[2],
          );
          if (time) {
            const prefix =
              source.path.includes("/logs/") || source.path === "docs/LOG.md"
                ? "LOG"
                : "NOTES";
            located.push({ at, alias: `${prefix}${time[1].padStart(5, "0")}` });
          }
          pendingAnchor = null;
        } else if (line.trim()) {
          pendingAnchor = null;
        }
      }
      at += line.length;
    }
    if (fence) {
      throw new Error(`來源有未閉合code fence：${source.path}`);
    }
    const starts = [...boundaries].sort((a, b) => a - b);
    const parts = starts.map((start, ordinal) => {
      const end = starts[ordinal + 1] ?? source.text.length,
        body = source.text.slice(start, end);
      const heading =
        /^#{1,6}\s+(.+)$/mu.exec(body)?.[1] ??
        `${source.path}：匯入脈絡 ${ordinal + 1}`;
      const explicit =
        /\b(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2})(?::\d{2})?)?(?:\s*(\+\d{4}|UTC|Asia\/Taipei))?/u.exec(
          heading,
        );
      return {
        ordinal,
        start,
        end,
        aliases: located
          .filter((a) => a.at >= start && a.at < end)
          .map((a) => a.alias),
        record: {
          kind:
            source.path.includes("/logs/") || source.path === "docs/LOG.md"
              ? ("log" as const)
              : ("note" as const),
          title: heading,
          body,
          eventDate: explicit?.[1] ?? null,
          eventTime:
            explicit?.[2] ??
            /(?:^|\s)([0-2]?\d:[0-5]\d)(?:\s|$|[：:])/u
              .exec(heading)?.[1]
              ?.padStart(5, "0") ??
            null,
          timezone: explicit?.[3] ?? null,
          origin: source.path,
          characters: [],
          sources: [],
        },
      };
    });
    if (parts.map((p) => p.record.body).join("") !== source.text) {
      throw new Error("區塊coverage不完整。");
    }
    return {
      path: source.path,
      bytes: Buffer.byteLength(source.text),
      hash: recordsHash(source.text),
      parts,
    };
  });
  const id = recordsHash(
    JSON.stringify({
      version: 2,
      files: files.map((f) => [f.path, f.bytes, f.hash]),
    }),
  );
  return { version: 2, id, files };
}
export function readRecordsSources(
  root: string,
  paths = RECORDS_INPUTS,
): RecordsSource[] {
  return paths.map((path) => {
    const bytes = readFileSync(resolve(root, path));
    const text = bytes.toString("utf8");
    if (!Buffer.from(text).equals(bytes)) {
      throw new Error("來源不是可無損還原的UTF-8。");
    }
    return { path, text };
  });
}
export function verifyRecordsImport(
  store: RecordsStore,
  plan: RecordsImportPlan,
) {
  for (const file of plan.files) {
    const rows = store.db
      .prepare(
        "SELECT record_id FROM import_parts WHERE import_id=? AND path=? ORDER BY ordinal",
      )
      .all(plan.id, file.path);
    const reconstructed = rows
      .map((r) => store.read(String(r.record_id), 1).body)
      .join("");
    if (
      rows.length !== file.parts.length ||
      Buffer.byteLength(reconstructed) !== file.bytes ||
      recordsHash(reconstructed) !== file.hash
    ) {
      throw new Error("匯入內容coverage／hash核對失敗。");
    }
    for (let n = 0; n < rows.length; n++) {
      if (
        JSON.stringify(
          validateRecord(store.read(String(rows[n].record_id), 1)),
        ) !== JSON.stringify(validateRecord(file.parts[n].record))
      ) {
        throw new Error("匯入中繼資料不符；時間、來源或類型不可省略。");
      }
      for (const alias of [file.path, ...file.parts[n].aliases]) {
        if (
          !store.db
            .prepare("SELECT 1 FROM aliases WHERE alias=? AND record_id=?")
            .get(alias, String(rows[n].record_id))
        ) {
          throw new Error("匯入alias缺漏。");
        }
      }
    }
  }
  store.integrity();
  return {
    id: plan.id,
    files: plan.files.length,
    bytes: plan.files.reduce((n, f) => n + f.bytes, 0),
    records: plan.files.reduce((n, f) => n + f.parts.length, 0),
    verified: true,
  };
}
/** 明確apply才寫入；呼叫者須提供重新讀取的來源，不能只信舊preview。 */
export function applyRecordsImport(
  store: RecordsStore,
  plan: RecordsImportPlan,
  currentSources: RecordsSource[],
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  const current = previewRecordsImport(currentSources);
  if (
    current.id !== plan.id ||
    JSON.stringify(current) !== JSON.stringify(plan)
  ) {
    throw new Error("preview後來源或分割方式已變更；未套用。");
  }
  return store.transaction(() => {
    const prior = store.db
      .prepare("SELECT manifest FROM imports WHERE id=?")
      .get(plan.id);
    if (prior) {
      return verifyRecordsImport(store, plan);
    }
    const paths = new Set(plan.files.map((f) => f.path));
    for (const old of store.db.prepare("SELECT manifest FROM imports").all()) {
      const manifest = JSON.parse(String(old.manifest)) as {
        files: { path: string }[];
      };
      if (manifest.files.some((f) => paths.has(f.path))) {
        throw new Error("來源路徑已有其他匯入版本；拒絕重複匯入。");
      }
    }
    store.db.prepare("INSERT INTO imports VALUES(?,?)").run(
      plan.id,
      JSON.stringify({
        version: plan.version,
        importedAt: Date.now(),
        files: plan.files.map(({ parts, ...file }) => ({
          ...file,
          parts: parts.length,
        })),
      }),
    );
    for (const file of plan.files) {
      for (const part of file.parts) {
        signal?.throwIfAborted();
        const receipt = store.append(
          `import:${plan.id}:${file.path}:${part.ordinal}`,
          part.record,
        );
        store.db
          .prepare("INSERT INTO import_parts VALUES(?,?,?,?)")
          .run(plan.id, file.path, part.ordinal, receipt.id);
        for (const alias of [file.path, ...part.aliases]) {
          store.alias(alias, receipt.id);
        }
      }
    }
    return verifyRecordsImport(store, plan);
  });
}
export function verifyStoredRecordsImport(store: RecordsStore, id: string) {
  const stored = store.db
    .prepare("SELECT manifest FROM imports WHERE id=?")
    .get(id);
  if (!stored) {
    throw new Error("找不到匯入manifest。");
  }
  const manifest = JSON.parse(String(stored.manifest)) as {
    version: number;
    files: { path: string; hash: string; bytes: number; parts: number }[];
  };
  if (manifest.version !== 2) {
    throw new Error("不支援的匯入格式版本；未改原資料。");
  }
  const sources = manifest.files.map((file) => ({
    path: file.path,
    text: store.db
      .prepare(
        "SELECT record_id FROM import_parts WHERE import_id=? AND path=? ORDER BY ordinal",
      )
      .all(id, file.path)
      .map((row) => store.read(String(row.record_id), 1).body)
      .join(""),
  }));
  const plan = previewRecordsImport(sources);
  if (
    plan.id !== id ||
    plan.files.some(
      (f, i) =>
        f.hash !== manifest.files[i].hash ||
        f.bytes !== manifest.files[i].bytes ||
        f.parts.length !== manifest.files[i].parts,
    )
  ) {
    throw new Error("庫內原始版本或manifest不符。");
  }
  return verifyRecordsImport(store, plan);
}
export function resolveRecordLink(origin: string, href: string) {
  if (/^[a-z][a-z0-9+.-]*:/iu.test(href) || href.startsWith("/")) {
    return { external: href };
  }
  const [path, anchor] = href.split("#", 2);
  const resolved = path
    ? posix.normalize(posix.join(posix.dirname(origin), path))
    : origin;
  return { alias: resolved + (anchor === undefined ? "" : `#${anchor}`) };
}
