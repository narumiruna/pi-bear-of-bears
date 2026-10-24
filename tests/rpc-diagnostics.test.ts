import process from "node:process";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Api, type TelegramClient } from "teleproto";
import { afterEach, expect, test, vi } from "vitest";
import { type BotTransport, Game } from "../src/game.js";
import { registerGameCommandTools } from "../src/game-commands.js";
import { toolResult } from "../src/output.js";
import {
  hasRpcRateLimit,
  instrumentRpc,
  newRpcDiagnostics,
  withRpcDiagnostics,
  withRpcPhase,
  withRpcStep,
} from "../src/rpc-diagnostics.js";
import {
  message,
  NOW,
  roomText,
  statusText,
  workflowHarness,
} from "./fixtures/workflow.js";

afterEach(() => vi.restoreAllMocks());

function rpcClient() {
  const invoke = vi.fn(
    async (_request: unknown, _dc?: unknown, _options?: unknown) => true,
  );
  const client = { invoke } as unknown as TelegramClient;
  instrumentRpc(client);
  instrumentRpc(client);
  return { client, invoke };
}

test("invoke 單一邊界記錄巢狀用途，保留 this／參數／錯誤，不保存原文", async () => {
  const { client, invoke } = rpcClient();
  const report = newRpcDiagnostics();
  const nested = newRpcDiagnostics();
  const request = new Api.updates.GetState();
  const error = Object.assign(new Error("不應保存：玩家與 session"), {
    seconds: 12,
  });
  await withRpcDiagnostics(report, () =>
    withRpcStep("bears_history", () =>
      withRpcPhase("history", async () => {
        expect(await client.invoke(request, 2)).toBe(true);
        invoke.mockRejectedValueOnce(error);
        await expect(
          withRpcDiagnostics(nested, () => client.invoke(request)),
        ).rejects.toBe(error);
      }),
    ),
  );
  expect(invoke.mock.contexts).toEqual([client, client]);
  expect(invoke.mock.calls[0]).toEqual([request, 2, undefined]);
  expect(report).toMatchObject({
    rpcCalls: 2,
    toolCalls: 1,
    omitted: 0,
    records: [
      {
        step: 1,
        tool: "bears_history",
        phase: "history",
        method: "updates.GetState",
        outcome: "returned",
      },
      {
        step: 1,
        tool: "bears_history",
        phase: "history",
        method: "updates.GetState",
        outcome: "rate_limited",
      },
    ],
  });
  expect(nested.rpcCalls).toBe(0);
  expect(JSON.stringify(report)).not.toMatch(/玩家|session|seconds/);
});

test("有界記錄、未知分類與關閉後的 async scope 不累積新請求", async () => {
  const { client } = rpcClient();
  const report = newRpcDiagnostics();
  let late: Promise<void> | undefined;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await withRpcDiagnostics(report, () =>
    withRpcStep("私密名稱", async () => {
      for (let i = 0; i < 513; i++) {
        await client.invoke({ className: "私密文字" } as never);
      }
      late = gate.then(async () => {
        await client.invoke(new Api.updates.GetState());
      });
    }),
  );
  release();
  await late;
  expect(report).toMatchObject({ rpcCalls: 513, omitted: 1 });
  expect(report.records).toHaveLength(512);
  expect(report.records[0]).toMatchObject({
    tool: "unclassified",
    method: "other_rpc",
  });
  expect(JSON.stringify(report)).not.toContain("私密");
});

test("pending 不冒稱 RPC 已返回；超過記錄上限的限流仍能停止當批", async () => {
  const { client, invoke } = rpcClient();
  const report = newRpcDiagnostics();
  let release!: (value: boolean) => void;
  invoke.mockImplementationOnce(
    () =>
      new Promise<boolean>((resolve) => {
        release = resolve;
      }),
  );
  await withRpcDiagnostics(report, async () => {
    const pending = client.invoke({ className: "updates.GetState" } as never);
    expect(report.records[0].outcome).toBe("pending");
    release(true);
    await pending;
    expect(report.records[0].outcome).toBe("returned");
    for (let i = 1; i < 512; i++) {
      await client.invoke({ className: "updates.GetState" } as never);
    }
    invoke.mockRejectedValueOnce(
      Object.assign(new Error("flood"), { seconds: 5 }),
    );
    await expect(
      client.invoke({ className: "updates.GetState" } as never),
    ).rejects.toThrow("flood");
    expect(hasRpcRateLimit()).toBe(true);
    expect(report.omitted).toBe(1);
  });
  expect(hasRpcRateLimit()).toBe(false);
});

type Scenario =
  | "normal"
  | "late"
  | "pages"
  | "announcement"
  | "before-limit"
  | "after-limit"
  | "auth-limit"
  | "cancel";

// 實際 WorkflowRunner + Game，合成 RPC client；不連線 Telegram。
async function replay(scenario: Scenario) {
  const started = performance.now();
  vi.spyOn(Date, "now").mockReturnValue(NOW);
  const app = workflowHarness();
  const point = app.seed();
  const rooms = Array.from({ length: 8 }, (_, index) => ({
    id: index + 1,
    name: index === 0 ? "星塔前庭" : `安全站${index}`,
    safe: true,
    boss: false,
    description: "",
    exits: {
      ...(index < 7 ? { 下: index + 2 } : {}),
      ...(index > 0 ? { 上: index } : {}),
    },
  }));
  app.world.allRooms = vi.fn(async () => rooms) as never;
  const { client, invoke } = rpcClient();
  const rpc = (method: string) => client.invoke({ className: method } as never);
  let location = 0;
  let goes = 0;
  let delayed = "";
  let failAfter = false;
  const controller = new AbortController();
  let historyCount = 0;
  let historiesAfterFirstMove = 0;
  const transport: BotTransport = {
    connect: async () => {
      if (scenario === "auth-limit") {
        invoke.mockRejectedValueOnce(
          Object.assign(new Error("flood"), { seconds: 8 }),
        );
        // library checkAuthorization 會吞掉 RPC 錯誤；仍不得因此補查。
        try {
          await rpc("updates.GetState");
        } catch {
          throw new Error("Telegram session expired.");
        }
      } else {
        await rpc("updates.GetState");
      }
    },
    close: async () => {},
    message: async () => undefined,
    click: async () => undefined,
    history: async () => {
      historyCount++;
      // 已確認第一步後的下一個 guard；不可多送一步。
      if (goes === 1) {
        historiesAfterFirstMove++;
      }
      if (
        scenario === "before-limit" &&
        historiesAfterFirstMove === 4 &&
        !failAfter
      ) {
        failAfter = true;
        invoke.mockRejectedValueOnce(
          Object.assign(new Error("flood"), { seconds: 8 }),
        );
      }
      if (scenario === "after-limit" && failAfter) {
        invoke.mockRejectedValueOnce(
          Object.assign(new Error("flood"), { seconds: 8 }),
        );
      }
      await rpc("messages.GetHistory");
      if (delayed && historyCount % 2 === 0) {
        app.raw.push(message(1000 + app.raw.length, delayed));
        delayed = "";
      }
      return [...app.raw].slice(-30);
    },
    send: async (text) => {
      await rpc("messages.SendMessage");
      if (text.startsWith("/go ")) {
        app.store.invalidate();
      }
      app.sent.push(text);
      app.raw.push(message(1000 + app.raw.length, text, true));
      let reply = "";
      if (text === "/status") {
        reply = statusText("測試熊", 900, 60, 1000, rooms[location].name);
      }
      if (text === "/look") {
        reply = roomText(rooms[location].name, "下、上");
      }
      if (text === "/go 下") {
        goes++;
        location++;
        reply = `你往下走去\n${roomText(rooms[location].name, "下、上")}`;
        if (scenario === "after-limit") {
          failAfter = true;
        }
        if (scenario === "cancel") {
          controller.abort();
        }
      }
      if (scenario === "late" && text === "/go 下" && goes === 1) {
        delayed = reply;
        // 第一個送後 history 不包含回覆，下一個有限補查才交付。
        historyCount = 0;
      } else if (reply) {
        app.raw.push(message(1000 + app.raw.length, reply));
      }
      if (scenario === "pages" && text === "/look") {
        // 同一批的重複頁不應新增任何指令。
        app.raw.push(message(1000 + app.raw.length, reply));
      }
      if (scenario === "announcement" && text === "/go 下") {
        app.raw.push(message(1000 + app.raw.length, "未知的背景公告"));
      }
    },
  };
  const game = new Game(async () => transport, 0);
  const pi = {
    registerTool: (tool: Parameters<ExtensionAPI["registerTool"]>[0]) =>
      app.tools.set(tool.name, tool),
  } as unknown as ExtensionAPI;
  registerGameCommandTools(pi, async (text, signal) => {
    const result = await game.act({ text }, signal);
    app.store.observe(result.messages, text);
    return toolResult(result);
  });
  const history = app.tools.get("bears_history");
  if (!history) {
    throw new Error("fixture 缺少 history");
  }
  history.execute = async (_id, _args, signal) => {
    const messages = await game.history(30, undefined, signal);
    app.store.observe(messages);
    return toolResult(messages);
  };
  const result = await app.call(
    "bears_move_to",
    { scope: app.scope(point.id), destination: 8 },
    controller.signal,
  );
  const diagnostics = result.data.rpcDiagnostics as ReturnType<
    typeof newRpcDiagnostics
  >;
  return {
    result,
    diagnostics,
    goes,
    sent: app.sent,
    elapsedMs: performance.now() - started,
  };
}

for (const scenario of [
  "normal",
  "late",
  "pages",
  "announcement",
  "before-limit",
  "after-limit",
  "auth-limit",
  "cancel",
] as const) {
  test(`固定七步 replay：${scenario}`, async () => {
    const { result, diagnostics, goes, sent, elapsedMs } =
      await replay(scenario);
    if (process.env.BEARS_WORKFLOW_METRICS_REPORT === "1") {
      process.stdout.write(
        `RPC_REPLAY_METRICS ${JSON.stringify({
          scenario,
          rpcCalls: diagnostics.rpcCalls,
          toolCalls: diagnostics.toolCalls,
          commands: sent.length,
          moves: goes,
          state: result.state,
          outputBytes: Buffer.byteLength(JSON.stringify(result)),
          elapsedMs,
        })}\n`,
      );
    }
    expect(diagnostics.rpcCalls).toBe(diagnostics.records.length);
    expect(
      diagnostics.records.every((record) => record.tool.startsWith("bears_")),
    ).toBe(true);
    expect(
      diagnostics.records.map(
        ({ step, tool, purpose, phase, method, outcome }) =>
          `${step} ${tool} ${purpose} ${phase} ${method} ${outcome}`,
      ),
    ).toMatchSnapshot();
    if (["normal", "late", "pages", "announcement"].includes(scenario)) {
      expect(result.state, JSON.stringify(result.blockers)).toBe("confirmed");
      expect(goes).toBe(7);
    } else {
      expect(result.state).not.toBe("confirmed");
      expect(goes, JSON.stringify(result.blockers)).toBe(
        scenario === "auth-limit" ? 0 : 1,
      );
      expect(result.data.interruption).toMatchObject({
        character: "測試熊",
        target: 8,
      });
    }
    expect(sent.filter((text) => text.startsWith("/go"))).toHaveLength(goes);
    if (scenario === "before-limit") {
      expect(diagnostics.records.at(-1)).toMatchObject({
        phase: "history",
        outcome: "rate_limited",
      });
    }
    if (scenario === "auth-limit") {
      expect(diagnostics.records).toHaveLength(1);
      expect(diagnostics.records[0]).toMatchObject({
        phase: "connect",
        outcome: "rate_limited",
      });
      expect(result.data.interruption).toMatchObject({
        stopCode: "rate_limited",
        delivery: "not_applicable",
      });
      expect(sent).toEqual([]);
    }
    if (scenario === "after-limit") {
      expect(diagnostics.records.at(-1)).toMatchObject({
        phase: "after_history",
        outcome: "rate_limited",
      });
    }
  });
}
