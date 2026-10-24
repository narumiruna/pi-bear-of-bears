import type { ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import type { TelegramClient } from "teleproto";
import { afterEach, expect, test, vi } from "vitest";
import { type BotTransport, Game, type GameMessage } from "../src/game.js";
import { toolResult } from "../src/output.js";
import {
  instrumentRpc,
  newRpcDiagnostics,
  withRpcDiagnostics,
} from "../src/rpc-diagnostics.js";
import { WorkflowObservations } from "../src/workflow-observations.js";
import { workflowResult } from "../src/workflow-result.js";
import { WorkflowRunner } from "../src/workflow-runner.js";
import {
  inventoryText,
  message,
  NOW,
  statusText,
} from "./fixtures/workflow.js";

afterEach(() => vi.restoreAllMocks());

for (const missing of [false, true]) {
  test(`有限背包收集：${missing ? "缺尾頁仍停止" : "中頁與尾頁晚到"}`, async () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    const store = new WorkflowObservations();
    const raw: GameMessage[] = [message(1, statusText())];
    store.observe(raw, "/status");
    const sent: string[] = [];
    const lines = inventoryText().split("\n");
    const pages = [
      lines.slice(0, 2).join("\n"),
      lines[2],
      lines.slice(3).join("\n"),
    ];
    const client = {
      invoke: vi.fn(async () => true),
    } as unknown as TelegramClient;
    instrumentRpc(client);
    const rpc = (className: string) => client.invoke({ className } as never);
    let reads = 0;
    const transport: BotTransport = {
      connect: async () => {
        await rpc("updates.GetState");
      },
      close: async () => {},
      message: async () => undefined,
      click: async () => undefined,
      send: async (text) => {
        await rpc("messages.SendMessage");
        sent.push(text);
        raw.push(message(2, text, true), message(3, pages[0]));
      },
      history: async () => {
        await rpc("messages.GetHistory");
        reads++;
        if (reads === 3) {
          raw.push(message(4, pages[1]));
        }
        if (reads === 4 && !missing) {
          raw.push(message(5, pages[2]));
        }
        return [...raw];
      },
    };
    const game = new Game(async () => transport, 0);
    const result = workflowResult("測試熊");
    const ctx = {
      executeTool: async (tool: string) => {
        const response =
          tool === "bears_inventory"
            ? await game.act({ text: "/inventory all" })
            : await game.history(30);
        const messages = Array.isArray(response) ? response : response.messages;
        store.observe(
          messages,
          tool === "bears_inventory" ? "/inventory all" : undefined,
        );
        return { result: await toolResult(response), isError: false };
      },
    } as unknown as ExtensionToolContext;
    const run = new WorkflowRunner(
      store,
      ctx,
      result,
      undefined,
      new AbortController().signal,
    );
    const report = newRpcDiagnostics();
    await withRpcDiagnostics(report, async () => {
      if (missing) {
        await expect(run.prepareInventory()).rejects.toThrow("結果不明");
      } else {
        expect((await run.prepareInventory()).complete).toBe(true);
        expect(store.inventory()?.value.entries).toHaveLength(3);
      }
    });
    expect(sent).toEqual(["/inventory all"]);
    expect(reads).toBe(4);
    expect(
      report.records.filter(
        (record) =>
          record.purpose === "delayed" &&
          record.method === "messages.GetHistory",
      ),
    ).toHaveLength(2);
    expect(
      report.records.map(
        ({ phase, method, purpose }) => `${purpose} ${phase} ${method}`,
      ),
    ).toMatchSnapshot();
    expect(store.inventory()?.value.complete).toBe(!missing);
  });
}
