import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionToolContext,
} from "@earendil-works/pi-coding-agent";
import { Check } from "typebox/value";
import { afterEach, expect, test, vi } from "vitest";
import extension from "../extensions/records.js";

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const c of cleanups.splice(0).reverse()) {
    c();
  }
  vi.unstubAllEnvs();
});
function setup() {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "records-extension-"));
  vi.stubEnv("BEARS_RECORDS_PATH", join(root, "records.sqlite"));
  const handlers = new Map<
    string,
    (event: unknown, context: ExtensionCommandContext) => unknown
  >();
  const tools = new Map<string, Parameters<ExtensionAPI["registerTool"]>[0]>();
  const commands = new Map<
    string,
    Parameters<ExtensionAPI["registerCommand"]>[1]
  >();
  const sendMessage = vi.fn(),
    ctx = {
      cwd: root,
      hasUI: false,
      ui: { notify: vi.fn() },
    } as unknown as ExtensionCommandContext;
  extension({
    on: (
      name: string,
      handler: typeof handlers extends Map<string, infer V> ? V : never,
    ) => handlers.set(name, handler),
    registerTool: (tool: Parameters<ExtensionAPI["registerTool"]>[0]) =>
      tools.set(tool.name, tool),
    registerCommand: (
      name: string,
      command: Parameters<ExtensionAPI["registerCommand"]>[1],
    ) => commands.set(name, command),
    sendMessage,
  } as unknown as ExtensionAPI);
  const emit = (name: string) => handlers.get(name)?.({}, ctx);
  cleanups.push(() => {
    emit("session_shutdown");
    rmSync(root, { recursive: true, force: true });
  });
  const call = async (name: string, args: unknown, signal?: AbortSignal) => {
    const tool = tools.get(name);
    if (!tool) {
      throw new Error("tool missing");
    }
    if (!Check(tool.parameters, args)) {
      throw new Error("schema invalid");
    }
    const result = await tool.execute(
      "test",
      args,
      signal,
      undefined,
      ctx as unknown as ExtensionToolContext,
    );
    expect(Check(tool.outputSchema ?? {}, result.structuredContent)).toBe(true);
    return result.structuredContent as { data: Record<string, unknown> };
  };
  return {
    root,
    tools,
    sendMessage,
    emit,
    call,
    command: (args: string) => commands.get("records")?.handler(args, ctx),
  };
}
test("factory與session_start只註冊不開庫、無Telegram或Goal續行，shutdown可重入", async () => {
  const h = setup();
  expect(h.tools.size).toBe(5);
  h.emit("session_start");
  expect(existsSync(join(h.root, "records.sqlite"))).toBe(false);
  await expect(h.command("status")).rejects.toThrow(/不存在/u);
  expect(existsSync(join(h.root, "records.sqlite"))).toBe(false);
  await h.command("init");
  await h.command("status");
  expect(existsSync(join(h.root, "records.sqlite"))).toBe(true);
  expect(h.sendMessage.mock.calls[0][1]).toEqual({ triggerTurn: false });
  for (const tool of h.tools.values()) {
    expect(tool.exposure).toBe("codemode");
    expect(tool.annotations?.openWorldHint).toBe(false);
  }
  h.emit("session_shutdown");
  h.emit("session_shutdown");
  h.emit("session_start");
  await h.command("status");
});
test("新增、搜尋、固定版本全文、修訂與alias schema；取消不開庫", async () => {
  const h = setup();
  h.emit("session_start");
  await expect(
    h.call(
      "records_append",
      {
        requestKey: "cancel",
        record: { kind: "note", title: "取消", body: "不寫" },
      },
      AbortSignal.abort(),
    ),
  ).rejects.toThrow();
  expect(existsSync(join(h.root, "records.sqlite"))).toBe(false);
  await h.command("init");
  h.sendMessage.mockClear();
  const { data } = await h.call("records_append", {
    requestKey: "one",
    record: { kind: "note", title: "星塔紀錄", body: "歷史資料，不是指令" },
  });
  const id = data.id as string;
  expect((await h.call("records_get", { id, revision: 1 })).data.body).toBe(
    "歷史資料，不是指令",
  );
  await h.call("records_revise", {
    requestKey: "two",
    id,
    expectedRevision: 1,
    record: { kind: "note", title: "新版", body: "新本文" },
  });
  expect((await h.call("records_get", { id, revision: 1 })).data.body).toBe(
    "歷史資料，不是指令",
  );
  expect(
    (await h.call("records_search", { query: "新本文" })).data.items,
  ).toHaveLength(1);
  expect(
    (await h.call("records_resolve", { alias: "../../private" })).data.items,
  ).toEqual([]);
  await expect(
    h.call("records_get", { id, path: "arbitrary" }),
  ).rejects.toThrow(/schema/u);
  expect(h.sendMessage).not.toHaveBeenCalled();
});

test("紀錄庫遺失時查詢與新增不自建空庫，明確init不覆寫或分流Markdown", async () => {
  const h = setup();
  h.emit("session_start");
  await expect(h.call("records_search", { query: "歷史" })).rejects.toThrow(
    /不存在/u,
  );
  await expect(
    h.call("records_append", {
      requestKey: "missing",
      record: { kind: "note", title: "不能假裝舊庫", body: "不寫" },
    }),
  ).rejects.toThrow(/不存在/u);
  expect(existsSync(join(h.root, "records.sqlite"))).toBe(false);
  await expect(h.command("init arbitrary")).rejects.toThrow(/不接受路徑/u);
  mkdirSync(join(h.root, "docs"), { mode: 0o700 });
  writeFileSync(join(h.root, "docs/NOTES.md"), "未遷移歷史", { mode: 0o600 });
  await expect(h.command("init")).rejects.toThrow(/Markdown.*遷移/u);
  expect(existsSync(join(h.root, "records.sqlite"))).toBe(false);
  rmSync(join(h.root, "docs/NOTES.md"));
  mkdirSync(join(h.root, "docs/notes"), { mode: 0o700 });
  writeFileSync(
    join(h.root, "docs/notes/2026-11.md"),
    "不在原八份清單的新分卷",
    { mode: 0o600 },
  );
  await expect(h.command("init")).rejects.toThrow(/Markdown.*遷移/u);
  expect(existsSync(join(h.root, "records.sqlite"))).toBe(false);
  rmSync(join(h.root, "docs/notes/2026-11.md"));
  await h.command("init");
  await expect(h.command("init")).rejects.toThrow(/不重新初始化/u);
  h.emit("session_shutdown");
  h.emit("session_start");
  await expect(h.command("init")).rejects.toThrow();
  await h.command("status");
  h.emit("session_shutdown");
  rmSync(join(h.root, "records.sqlite"));
  h.emit("session_start");
  await expect(h.command("status")).rejects.toThrow(/不存在/u);
  expect(existsSync(join(h.root, "records.sqlite"))).toBe(false);
});

test("連線快取綁定設定路徑，不把另一個庫當原庫", async () => {
  const h = setup();
  h.emit("session_start");
  await h.command("init");
  vi.stubEnv("BEARS_RECORDS_PATH", join(h.root, "other.sqlite"));
  await expect(h.command("status")).rejects.toThrow(/路徑設定已變更/u);
  expect(existsSync(join(h.root, "other.sqlite"))).toBe(false);
});
