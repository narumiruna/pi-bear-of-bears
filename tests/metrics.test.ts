import { randomUUID } from "node:crypto";
import {
  appendFile,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { discoverAndLoadExtensions } from "@earendil-works/pi-coding-agent";
import { afterEach, expect, test, vi } from "vitest";
import extension from "../extensions/metrics.js";
import {
  classifyOutcome,
  commandCategory,
  type MetricRecord,
  summarizeMetrics,
} from "../src/metrics.js";
import { MetricsStore, metricsDirectory } from "../src/metrics-store.js";

const directories: string[] = [];
async function temporary() {
  const dir = await mkdtemp(join(tmpdir(), "bears-metrics-test-"));
  directories.push(dir);
  return dir;
}
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const dir of directories.splice(0))
    await rm(dir, { recursive: true, force: true });
});
function record(phase: MetricRecord["phase"] = "start"): MetricRecord {
  return {
    version: 1,
    at: new Date().toISOString(),
    id: randomUUID(),
    phase,
    tool: "bears_send",
    command: "/chat",
  };
}
function harness() {
  type Handler = (event: unknown, ctx: ExtensionContext) => unknown;
  type Command = {
    handler: (args: string, ctx: ExtensionContext) => Promise<void>;
  };
  const handlers = new Map<string, Handler>();
  const commands = new Map<string, Command>();
  const sendMessage = vi.fn();
  const notify = vi.fn();
  const ctx = { hasUI: true, ui: { notify } } as unknown as ExtensionContext;
  extension({
    on: (name: string, handler: Handler) => handlers.set(name, handler),
    registerCommand: (name: string, command: Command) =>
      commands.set(name, command),
    sendMessage,
  } as unknown as ExtensionAPI);
  return {
    sendMessage,
    notify,
    emit: (name: string, event = {}) => handlers.get(name)?.(event, ctx),
    command: (args = "") => commands.get("bears-metrics")?.handler(args, ctx),
  };
}

test("預設統計目錄跟隨 pi agent 目錄，明確設定優先", async () => {
  const dir = await temporary();
  vi.stubEnv("PI_CODING_AGENT_DIR", dir);
  expect(metricsDirectory({})).toBe(join(dir, "bear-of-bears", "metrics"));
  expect(metricsDirectory({ BEARS_METRICS_DIR: join(dir, "custom") })).toBe(
    join(dir, "custom"),
  );
});

test("相對 pi agent 目錄解析為絕對統計路徑", () => {
  vi.stubEnv("PI_CODING_AGENT_DIR", ".pi/agent");
  expect(metricsDirectory({})).toBe(resolve(".pi/agent/bear-of-bears/metrics"));
});

test("指令只保留允許清單分類，移除引數與私人文字", () => {
  expect(commandCategory("/say 私人聊天內容")).toBe("/say");
  expect(commandCategory("/STATUS@BearOfBearsBot")).toBe("/status");
  expect(commandCategory("北")).toBe("/go");
  expect(commandCategory("掛機")).toBe("/idle");
  expect(commandCategory("/secretAccount123")).toBe("other_text");
  expect(commandCategory("/unlisted")).toBe("unknown_command");
  expect(commandCategory("私人聊天內容")).toBe("other_text");
  expect(commandCategory("__proto__")).toBe("other_text");
  expect(commandCategory(null)).toBe("invalid_text");
});

test("只分類工具錯誤與結構化觀測，不把遊戲文字當誤用判決", () => {
  const result = (text: string) => ({ content: [{ type: "text", text }] });
  expect(
    classifyOutcome(
      result(
        "Message missing or changed. Read bears_history and choose again.",
      ),
      true,
    ),
  ).toBe("stale_button");
  expect(
    classifyOutcome(result("A Telegram operation is already running."), true),
  ).toBe("overlap_rejected");
  expect(
    classifyOutcome(
      result("Only ordinary text and callback buttons are supported;"),
      true,
    ),
  ).toBe("unsupported_button");
  expect(
    classifyOutcome(result("Validation failed for tool bears_send"), true),
  ).toBe("invalid_arguments");
  expect(
    classifyOutcome(result("Telegram rate limit: wait 10 seconds"), true),
  ).toBe("rate_limited");
  expect(
    classifyOutcome(
      result(
        "Telegram rate limit: Action may have reached the bot; outcome is unknown.",
      ),
      true,
    ),
  ).toBe("outcome_unknown");
  expect(
    classifyOutcome(result('{"observation":"no_update_yet"}'), false),
  ).toBe("no_update_yet");
  expect(
    classifyOutcome(result('{"observation":"bot_updates_observed"}'), false),
  ).toBe("updates_observed");
  expect(
    classifyOutcome(
      result("玩家說：A Telegram operation is already running."),
      false,
    ),
  ).toBe("returned");
  expect(classifyOutcome(result("秘密憑證"), true)).toBe("tool_error");
});

test("跨實例持久化且不覆蓋；損壞尾行可辨識；拒絕符號連結", async () => {
  const dir = await temporary();
  const first = new MetricsStore(dir);
  const second = new MetricsStore(dir);
  const start = record();
  first.append(start);
  second.append({
    ...start,
    phase: "end",
    outcome: "returned",
    durationMs: 10,
  });
  const names = await readdir(dir);
  expect(names).toHaveLength(2);
  expect((await stat(join(dir, names[0]))).mode & 0o777).toBe(0o600);
  await appendFile(join(dir, names[0]), '{"incomplete":\n');
  const data = await new MetricsStore(dir).read();
  expect(data.records).toHaveLength(2);
  expect(data.skipped).toBe(1);
  const outside = join(dir, "outside");
  await writeFile(outside, "不應讀取");
  await symlink(outside, join(dir, `${randomUUID()}.jsonl`));
  await expect(first.read()).rejects.toThrow();
});

test("統計固定時間區間、去重、耗時與人工標記；未完成不算成功", () => {
  const start = record();
  const end: MetricRecord = {
    ...start,
    phase: "end",
    outcome: "no_update_yet",
    durationMs: 50,
  };
  const manual: MetricRecord = {
    ...record("manual"),
    mark: "capability_missed",
  };
  const old = { ...record(), at: "2000-01-01T00:00:00Z" };
  const text = summarizeMetrics([start, start, end, manual, old], 30);
  expect(text).toContain("bears_send /chat | 1 | 1 | 50 | no_update_yet=1");
  expect(text).toContain("capability_missed /chat: 1");
  expect(text).toContain("不直接等於 Agent 誤用");
});

test("extension 被動記錄、忽略重複事件與非遊戲工具，reload 不重播歷史", async () => {
  const dir = await temporary();
  vi.stubEnv("BEARS_METRICS_DIR", dir);
  vi.stubEnv("BEARS_METRICS", "1");
  const h = harness();
  h.emit("session_start");
  const call = {
    toolCallId: "private-call-id",
    toolName: "bears_send",
    args: { text: "/say 私人內容" },
  };
  expect(h.emit("tool_execution_start", call)).toBeUndefined();
  h.emit("tool_execution_start", call);
  h.emit("tool_execution_start", {
    ...call,
    toolName: "bash",
    toolCallId: "bash",
  });
  h.emit("tool_execution_end", {
    ...call,
    isError: false,
    result: {
      content: [
        {
          type: "text",
          text: '{"observation":"no_update_yet","messages":["私人內容"]}',
        },
      ],
    },
  });
  h.emit("tool_execution_end", call);
  h.emit("session_shutdown");
  h.emit("session_start");
  const data = await new MetricsStore(dir).read();
  expect(data.records).toHaveLength(2);
  const text = (
    await Promise.all(
      (await readdir(dir)).map((name) => readFile(join(dir, name), "utf8")),
    )
  ).join("");
  expect(text).not.toContain("私人內容");
  expect(text).not.toContain("private-call-id");
  expect(h.sendMessage).not.toHaveBeenCalled();
  await h.command("mark capability_missed /chat");
  await h.command("30");
  expect(h.sendMessage.mock.lastCall?.[0].content).toContain(
    "capability_missed /chat: 1",
  );
  expect(h.sendMessage.mock.lastCall?.[1]).toEqual({ triggerTurn: false });
});

test("R12：optimizer 成功與錯誤均記錄次數、耗時與分類，不保存內容", async () => {
  const dir = await temporary();
  vi.stubEnv("BEARS_METRICS_DIR", dir);
  vi.stubEnv("BEARS_METRICS", "1");
  const h = harness();
  h.emit("session_start");
  for (const isError of [false, true]) {
    const call = {
      toolCallId: String(isError),
      toolName: "bears_optimize_equipment",
      args: { weights: { attack: 12345 } },
    };
    h.emit("tool_execution_start", call);
    h.emit("tool_execution_end", {
      ...call,
      isError,
      result: { content: [{ type: "text", text: "私人測試內容" }] },
    });
  }
  const { records } = await new MetricsStore(dir).read();
  expect(records).toHaveLength(4);
  expect(
    records.filter((x) => x.phase === "end").map((x) => x.outcome),
  ).toEqual(["returned", "tool_error"]);
  expect(
    records
      .filter((x) => x.phase === "end")
      .every((x) => Number.isFinite(x.durationMs)),
  ).toBe(true);
  expect(JSON.stringify(records)).not.toMatch(/私人測試內容|12345|weights/);
  await h.command();
  expect(h.sendMessage.mock.lastCall?.[0].content).toContain(
    "bears_optimize_equipment | 2 | 2 |",
  );
});

test("停用與寫入失敗不影響工具；不接受自由文字標記", async () => {
  const dir = await temporary();
  vi.stubEnv("BEARS_METRICS_DIR", dir);
  vi.stubEnv("BEARS_METRICS", "0");
  const h = harness();
  h.emit("session_start");
  h.emit("tool_execution_start", {
    toolName: "bears_history",
    toolCallId: "1",
  });
  expect(await readdir(dir)).toEqual([]);
  vi.stubEnv("BEARS_METRICS", "1");
  h.emit("session_start");
  await h.command("mark wrong_command /say 私人內容");
  expect(await readdir(dir)).toEqual([]);
  const file = join(dir, "not-a-directory");
  await writeFile(file, "");
  vi.stubEnv("BEARS_METRICS_DIR", file);
  h.emit("session_start");
  expect(() =>
    h.emit("tool_execution_start", {
      toolName: "bears_history",
      toolCallId: "2",
    }),
  ).not.toThrow();
  h.emit("tool_execution_start", {
    toolName: "bears_history",
    toolCallId: "3",
  });
  expect(h.notify).toHaveBeenCalledTimes(1);
  expect(() => metricsDirectory({ BEARS_METRICS_DIR: "relative" })).toThrow();
});

test("pi 可獨立載入統計 extension，初始化不寫檔、不建立 Telegram 連線", async () => {
  const dir = await temporary();
  const result = await discoverAndLoadExtensions(
    [resolve("extensions/metrics.ts")],
    dir,
    dir,
  );
  expect(result.errors).toEqual([]);
  expect(result.extensions[0].commands.has("bears-metrics")).toBe(true);
  expect(result.extensions[0].tools.size).toBe(0);
  expect(await readdir(dir)).toEqual([]);
});
