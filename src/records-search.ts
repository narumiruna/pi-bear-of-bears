import type { DatabaseSync } from "node:sqlite";
import {
  boundRecordsSearch,
  type RecordRevision,
  type RecordsQuery,
  recordsHash,
} from "./records-data.js";

const parse = <T>(value: unknown): T => JSON.parse(String(value)) as T;
export function searchRecords(
  db: DatabaseSync,
  identity: {
    databaseId: string;
    trigram: boolean;
    reference: (id: string, revision: number) => string;
  },
  input: RecordsQuery = {},
) {
  const { cursor, ...rest } = input;
  const filters = {
    query: rest.query ?? "",
    kind: rest.kind ?? null,
    character: rest.character ?? null,
    from: rest.from ?? null,
    through: rest.through ?? null,
    limit: rest.limit ?? 10,
  };
  if (
    filters.query.length > 300 ||
    !Number.isInteger(filters.limit) ||
    filters.limit < 1 ||
    filters.limit > 10
  ) {
    throw new Error("搜尋文字或頁面上限無效。");
  }
  let offset = 0;
  const epoch = Number(
      db.prepare("SELECT epoch FROM records_meta WHERE id=1").get()?.epoch,
    ),
    signature = recordsHash(JSON.stringify(filters));
  if (cursor) {
    const decoded = parse<{
      databaseId: string;
      epoch: number;
      signature: string;
      offset: number;
    }>(Buffer.from(cursor, "base64url").toString());
    if (
      decoded.databaseId !== identity.databaseId ||
      decoded.epoch !== epoch ||
      decoded.signature !== signature ||
      !Number.isSafeInteger(decoded.offset) ||
      decoded.offset < 0
    ) {
      throw new Error("搜尋游標已過期或條件不符；請重新搜尋。");
    }
    offset = decoded.offset;
  }
  const where = ["1=1"],
    values: (string | number)[] = [];
  const add = (sql: string, value: string) => {
    where.push(sql);
    values.push(value);
  };
  for (const date of [filters.from, filters.through]) {
    if (date !== null && !/^\d{4}-\d{2}-\d{2}$/u.test(date)) {
      throw new Error("日期篩選須為YYYY-MM-DD。");
    }
  }
  if (filters.from && filters.through && filters.from > filters.through) {
    throw new Error("日期篩選起訖相反。");
  }
  const query = filters.query;
  if (query) {
    if (
      identity.trigram &&
      Array.from(query).length >= 3 &&
      !Array.from(query).some((c) => c.charCodeAt(0) < 32)
    ) {
      add(
        "c.record_id IN (SELECT record_id FROM records_fts WHERE records_fts MATCH ?)",
        `"${query.replaceAll('"', '""')}"`,
      );
    }
    add("instr(CAST(c.search_text AS BLOB),CAST(lower(?) AS BLOB)) > 0", query);
  }
  if (filters.kind) {
    add("c.kind=?", filters.kind);
  }
  if (filters.character) {
    add(
      "EXISTS(SELECT 1 FROM json_each(c.characters) WHERE value=?)",
      filters.character,
    );
  }
  if (filters.from) {
    add("c.event_date>=?", filters.from);
  }
  if (filters.through) {
    add("c.event_date<=?", filters.through);
  }
  const rows = db
    .prepare(
      `WITH selected AS MATERIALIZED (SELECT c.record_id,c.event_date FROM records_current c WHERE ${where.join(" AND ")} ORDER BY c.event_date DESC,c.record_id LIMIT ? OFFSET ?) SELECT v.data FROM selected s JOIN records r ON r.id=s.record_id JOIN revisions v ON v.record_id=r.id AND v.revision=r.revision ORDER BY s.event_date DESC,s.record_id`,
    )
    .all(...values, filters.limit + 1, offset);
  const items = rows.slice(0, filters.limit).map((r) => {
    const row = parse<RecordRevision>(r.data);
    const combined = `${row.title}\n${row.body}`;
    const asciiLower = (s: string) =>
      s.replace(/[A-Z]/gu, (c) => c.toLowerCase());
    const match = query ? asciiLower(combined).indexOf(asciiLower(query)) : -1;
    const start =
      match < 0
        ? 0
        : Math.max(0, Array.from(combined.slice(0, match)).length - 16);
    return {
      id: row.id,
      revision: row.revision,
      kind: row.kind,
      title: Array.from(row.title).slice(0, 50).join(""),
      eventDate: row.eventDate,
      excerpt: Array.from(combined)
        .slice(start, start + 50)
        .join(""),
      reference: identity.reference(row.id, row.revision),
    };
  });
  return boundRecordsSearch({
    items,
    nextCursor:
      rows.length > filters.limit
        ? Buffer.from(
            JSON.stringify({
              databaseId: identity.databaseId,
              epoch,
              signature,
              offset: offset + filters.limit,
            }),
          ).toString("base64url")
        : null,
    operationalEligibility: false as const,
  });
}
