import { randomUUID } from "node:crypto";
import { closeSync, constants, mkdirSync, openSync, writeSync } from "node:fs";
import { open, readdir } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import {
  commandCategory,
  MANUAL_MARKS,
  METRIC_TOOLS,
  type MetricRecord,
} from "./metrics.js";

export function metricsDirectory(env: NodeJS.ProcessEnv = process.env) {
  const directory =
    env.BEARS_METRICS_DIR ?? resolve(getAgentDir(), "bear-of-bears", "metrics");
  if (!isAbsolute(directory))
    throw new Error("BEARS_METRICS_DIR 必須是絕對路徑。");
  return directory;
}

// 每個 extension 實例使用獨立檔案，避免多程序 read-modify-write 遺失計數。
export class MetricsStore {
  private path?: string;
  constructor(readonly directory: string) {}
  append(record: MetricRecord) {
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    if (!this.path) this.path = join(this.directory, `${randomUUID()}.jsonl`);
    const fd = openSync(
      this.path,
      constants.O_WRONLY |
        constants.O_APPEND |
        constants.O_CREAT |
        constants.O_NOFOLLOW,
      0o600,
    );
    try {
      const buffer = Buffer.from(`${JSON.stringify(record)}\n`);
      let offset = 0;
      while (offset < buffer.length) offset += writeSync(fd, buffer, offset);
    } finally {
      closeSync(fd);
    }
  }
  async read(): Promise<{ records: MetricRecord[]; skipped: number }> {
    let names: string[];
    try {
      names = await readdir(this.directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        return { records: [], skipped: 0 };
      throw error;
    }
    const records: MetricRecord[] = [];
    let skipped = 0;
    for (const name of names
      .filter((item) => /^[a-f0-9-]{36}\.jsonl$/.test(item))
      .sort()) {
      const file = await open(
        join(this.directory, name),
        constants.O_RDONLY | constants.O_NOFOLLOW,
      );
      try {
        const stat = await file.stat();
        if (!stat.isFile() || stat.size > 32 * 1024 * 1024)
          throw new Error(
            "統計檔案不是一般檔案或超過 32 MiB；請先封存舊紀錄。",
          );
        for await (const line of file.readLines()) {
          try {
            const record = JSON.parse(line);
            if (!validRecord(record)) {
              skipped++;
              continue;
            }
            records.push(record);
            if (records.length > 200000)
              throw new RangeError("統計超過 200000 筆；請先封存舊紀錄。");
          } catch (error) {
            if (error instanceof RangeError) throw error;
            skipped++;
          }
        }
      } finally {
        await file.close();
      }
    }
    return { records, skipped };
  }
}

const outcomes = new Set([
  "returned",
  "updates_observed",
  "no_update_yet",
  "stale_button",
  "unsupported_button",
  "overlap_rejected",
  "invalid_arguments",
  "outcome_unknown",
  "rate_limited",
  "tool_error",
]);
function validRecord(value: unknown): value is MetricRecord {
  if (!value || typeof value !== "object") return false;
  const r = value as MetricRecord;
  if (
    r.version !== 1 ||
    typeof r.at !== "string" ||
    !Number.isFinite(Date.parse(r.at)) ||
    typeof r.id !== "string" ||
    !/^[a-f0-9-]{36}$/.test(r.id)
  )
    return false;
  if (
    r.command !== undefined &&
    !(
      commandCategory(r.command) === r.command ||
      ["invalid_text", "other_text", "unknown_command"].includes(r.command)
    )
  )
    return false;
  if (r.phase === "manual")
    return typeof r.mark === "string" && MANUAL_MARKS.has(r.mark);
  if (!r.tool || !METRIC_TOOLS.has(r.tool)) return false;
  if (r.phase === "start") return true;
  return (
    r.phase === "end" &&
    outcomes.has(r.outcome ?? "") &&
    typeof r.durationMs === "number" &&
    Number.isFinite(r.durationMs) &&
    r.durationMs >= 0
  );
}
