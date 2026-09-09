import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { expect, test, vi } from "vitest";
import extension from "../extensions/status.js";

function harness() {
  const tools = new Map<string, Parameters<ExtensionAPI["registerTool"]>[0]>();
  const handlers = new Map<
    string,
    (event: unknown, ctx: ExtensionContext) => unknown
  >();
  const widget = vi.fn();
  let branch: Array<Record<string, unknown>> = [];
  const context = {
    hasUI: true,
    mode: "rpc",
    sessionManager: { getBranch: () => branch },
    ui: { setWidget: widget },
  } as unknown as ExtensionContext;
  const pi = {
    registerTool: (tool: Parameters<ExtensionAPI["registerTool"]>[0]) =>
      tools.set(tool.name, tool),
    on: (
      name: string,
      handler: (event: unknown, ctx: ExtensionContext) => unknown,
    ) => handlers.set(name, handler),
  } as unknown as ExtensionAPI;
  extension(pi);

  return {
    tools,
    widget,
    setBranch(next: Array<Record<string, unknown>>) {
      branch = next;
    },
    async event(name: string) {
      await handlers.get(name)?.({}, context);
    },
    async update(params: { title?: string; items: string[] }) {
      const tool = tools.get("update_status");
      if (!tool) throw new Error("缺少 update_status tool");
      return tool.execute("test", params, undefined, undefined, context);
    },
  };
}

test("update_status 完整替換、清除並依目前分支還原 widget", async () => {
  const app = harness();
  expect([...app.tools.keys()]).toEqual(["update_status"]);
  expect(
    app.tools.get("update_status")?.promptGuidelines?.join("\n"),
  ).toContain("主動呼叫 update_status");

  await app.event("session_start");
  expect(app.widget.mock.lastCall).toEqual(["llm-status", undefined]);

  const result = await app.update({
    title: " 配裝進度 ",
    items: ["已取得完整背包", "下一步：\n比較武器"],
  });
  expect(result.content[0]).toEqual({
    type: "text",
    text: "狀態面板已更新（2 項）。",
  });
  expect(result.details).toEqual({
    version: 1,
    title: "配裝進度",
    items: ["已取得完整背包", "下一步： 比較武器"],
  });
  expect(app.widget.mock.lastCall?.[2]).toEqual({ placement: "aboveEditor" });
  expect(app.widget.mock.lastCall?.[1].join("\n")).toContain("◆ 配裝進度");
  expect(app.widget.mock.lastCall?.[1].join("\n")).toContain(
    "• 下一步： 比較武器",
  );

  app.setBranch([
    {
      type: "message",
      message: {
        role: "toolResult",
        toolName: "update_status",
        details: {
          version: 1,
          title: "分支狀態",
          items: ["只顯示目前分支的資訊"],
        },
      },
    },
  ]);
  await app.event("session_tree");
  expect(app.widget.mock.lastCall?.[1].join("\n")).toContain("◆ 分支狀態");

  const cleared = await app.update({ items: [] });
  expect(cleared.content[0]).toEqual({
    type: "text",
    text: "狀態面板已清除。",
  });
  expect(app.widget.mock.lastCall).toEqual(["llm-status", undefined]);

  await app.event("session_shutdown");
  expect(app.widget.mock.lastCall).toEqual(["llm-status", undefined]);
});
