import { createHash } from "node:crypto";
import { closeSync, constants, lstatSync, openSync } from "node:fs";
export interface RecordInput {
  kind: "note" | "log";
  title: string;
  body: string;
  eventDate?: string | null;
  eventTime?: string | null;
  timezone?: string | null;
  observedAt?: number | null;
  characters?: string[];
  sources?: string[];
  origin?: string | null;
}
export interface RecordRevision extends RecordInput {
  id: string;
  revision: number;
  createdAt: number;
}
export const recordsHash = (value: string) =>
  createHash("sha256").update(value).digest("hex");

export function privateRecordsFile(path: string, create = false) {
  if (create) {
    try {
      const fd = openSync(
        path,
        constants.O_CREAT |
          constants.O_EXCL |
          constants.O_WRONLY |
          constants.O_NOFOLLOW,
        0o600,
      );
      closeSync(fd);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw error;
      }
    }
  }
  try {
    const stat = lstatSync(path);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.nlink !== 1 ||
      (stat.mode & 0o077) !== 0
    ) {
      throw new Error("紀錄庫必須是私有單一連結的一般檔案。");
    }
  } catch (error) {
    if (!create && (error as NodeJS.ErrnoException).code === "ENOENT") {
      return;
    }
    throw error;
  }
}
export function validateRecord(input: RecordInput): RecordInput {
  if (
    !["note", "log"].includes(input.kind) ||
    !input.title.trim() ||
    input.title.length > 1000 ||
    Buffer.byteLength(input.body) > 2_000_000
  ) {
    throw new Error("紀錄類型、標題或本文超限。");
  }
  if (
    input.eventDate != null &&
    !/^\d{4}-\d{2}-\d{2}$/u.test(input.eventDate)
  ) {
    throw new Error("事件日期須為明示的 YYYY-MM-DD 或 null。");
  }
  for (const list of [input.characters ?? [], input.sources ?? []]) {
    if (
      list.length > 100 ||
      list.some((v) => typeof v !== "string" || !v || v.length > 300)
    ) {
      throw new Error("角色或來源欄位超限。");
    }
  }
  if (Buffer.byteLength(JSON.stringify({ ...input, body: "" })) > 12000) {
    throw new Error("紀錄中繼資料超限。");
  }
  if (
    input.observedAt != null &&
    (!Number.isSafeInteger(input.observedAt) || input.observedAt < 0)
  ) {
    throw new Error("observedAt須為明示Unix毫秒或null。");
  }
  return {
    kind: input.kind,
    title: input.title,
    body: input.body,
    eventDate: input.eventDate ?? null,
    eventTime: input.eventTime ?? null,
    timezone: input.timezone ?? null,
    observedAt: input.observedAt ?? null,
    characters: [...new Set(input.characters ?? [])].sort(),
    sources: [...new Set(input.sources ?? [])].sort(),
    origin: input.origin ?? null,
  };
}
export function boundRecordsSearch<
  T extends { items: { title: string; excerpt: string }[] },
>(result: T): T {
  while (
    Buffer.byteLength(JSON.stringify(result)) > 7800 &&
    result.items.some((i) => i.title.length + i.excerpt.length > 0)
  ) {
    for (const item of result.items) {
      item.title = Array.from(item.title)
        .slice(0, Math.floor(Array.from(item.title).length / 2))
        .join("");
      item.excerpt = Array.from(item.excerpt)
        .slice(0, Math.floor(Array.from(item.excerpt).length / 2))
        .join("");
    }
  }
  if (Buffer.byteLength(JSON.stringify(result)) > 8000) {
    throw new Error("搜尋中繼資料超限；請縮小頁面。");
  }
  return result;
}
export interface RecordsQuery {
  query?: string;
  kind?: "note" | "log";
  character?: string;
  from?: string;
  through?: string;
  limit?: number;
  cursor?: string;
}
