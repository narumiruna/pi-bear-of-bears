import type {
  ExtensionAPI,
  ExtensionContext,
  ExtensionToolContext,
} from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { expect, test, vi } from "vitest";
import extension from "../extensions/status.js";

function harness(mode: "rpc" | "tui" = "rpc") {
  const tools = new Map<string, Parameters<ExtensionAPI["registerTool"]>[0]>();
  const handlers = new Map<
    string,
    (event: unknown, ctx: ExtensionContext) => unknown
  >();
  const shortcuts = new Map<
    string,
    Parameters<ExtensionAPI["registerShortcut"]>[1]
  >();
  const widget = vi.fn();
  let branch: Record<string, unknown>[] = [];
  const context = {
    hasUI: true,
    mode,
    sessionManager: { getBranch: () => branch },
    ui: { setWidget: widget },
    tools: [],
    executeTool: vi
      .fn()
      .mockRejectedValue(new Error("測試 harness 不支援巢狀工具呼叫")),
  } as unknown as ExtensionToolContext;
  const pi = {
    registerTool: (tool: Parameters<ExtensionAPI["registerTool"]>[0]) =>
      tools.set(tool.name, tool),
    registerShortcut: (
      key: string,
      options: Parameters<ExtensionAPI["registerShortcut"]>[1],
    ) => shortcuts.set(key, options),
    on: (
      name: string,
      handler: (event: unknown, ctx: ExtensionContext) => unknown,
    ) => handlers.set(name, handler),
  } as unknown as ExtensionAPI;
  extension(pi);

  return {
    tools,
    shortcuts,
    widget,
    toggle() {
      const shortcut = shortcuts.get("ctrl+alt+b");
      if (!shortcut) {
        throw new Error("缺少面板切換快捷鍵");
      }
      return shortcut.handler(context);
    },
    render(width = 72): string[] {
      const value = widget.mock.lastCall?.[1];
      if (typeof value === "function") {
        return value(
          {},
          {
            fg: (_color: string, text: string) => text,
            bold: (text: string) => text,
          },
        ).render(width);
      }
      if (Array.isArray(value)) {
        return value;
      }
      throw new Error("缺少可渲染的狀態面板");
    },
    setBranch(next: Record<string, unknown>[]) {
      branch = next;
    },
    async event(name: string) {
      await handlers.get(name)?.({}, context);
    },
    update(params: { title?: string; items: string[] }) {
      const tool = tools.get("update_status");
      if (!tool) {
        throw new Error("缺少 update_status tool");
      }
      return tool.execute("test", params, undefined, undefined, context);
    },
  };
}

test.each(["rpc", "tui"] as const)(
  "%s 快捷鍵切換面板，隱藏時保留最新更新",
  async (mode) => {
    const app = harness(mode);
    expect([...app.shortcuts.keys()]).toEqual(["ctrl+alt+b"]);
    await app.update({ items: ["原始資訊"] });
    expect(app.render().join("\n")).toContain("原始資訊");
    await app.toggle();
    expect(app.widget.mock.lastCall).toEqual(["llm-status", undefined]);
    const result = await app.update({ items: ["最新資訊"] });
    expect(result.details).toMatchObject({ items: ["最新資訊"] });
    expect(app.widget.mock.lastCall).toEqual(["llm-status", undefined]);
    await app.toggle();
    expect(app.render().join("\n")).toContain("最新資訊");
    expect(app.render().join("\n")).not.toContain("原始資訊");
  },
);

test("隱藏偏好跨分支保留，新 session 預設顯示；無內容也可切換", async () => {
  const app = harness();
  await app.toggle();
  expect(app.widget.mock.lastCall).toEqual(["llm-status", undefined]);
  app.setBranch([
    {
      type: "message",
      message: {
        role: "toolResult",
        toolName: "update_status",
        details: { version: 1, title: "分支狀態", items: ["還原資訊"] },
      },
    },
  ]);
  await app.event("session_tree");
  expect(app.widget.mock.lastCall).toEqual(["llm-status", undefined]);
  await app.toggle();
  expect(app.render().join("\n")).toContain("還原資訊");
  await app.toggle();
  await app.event("session_shutdown");
  await app.event("session_start");
  expect(app.render().join("\n")).toContain("還原資訊");
});

test.each(["rpc", "tui"] as const)(
  "%s 面板可在 10 行內完整顯示標題與七項短資訊",
  async (mode) => {
    const app = harness(mode);
    const items = Array.from(
      { length: 7 },
      (_, index) => `第 ${index + 1} 項狀態`,
    );
    await app.update({ title: "七項資訊", items });
    const lines = app.render();
    expect(lines).toHaveLength(10);
    expect(lines[1]).toBe("◆ 七項資訊");
    expect(lines.slice(2, -1)).toEqual(items.map((item) => `• ${item}`));
    expect(lines.join("\n")).not.toContain("其餘資訊已截短");
  },
);

test.each(["rpc", "tui"] as const)(
  "%s 面板長文字換行後仍限制於 10 行",
  async (mode) => {
    const app = harness(mode);
    await app.update({
      items: Array.from({ length: 8 }, () => "寬字🐻".repeat(30)),
    });
    const lines = app.render();
    expect(lines).toHaveLength(10);
    expect(lines.at(-2)).toBe("…其餘資訊已截短");
    expect(lines.every((line) => visibleWidth(line) <= 72)).toBe(true);
  },
);

test("八項資訊仍完整保存，超出 10 行只截短畫面", async () => {
  const app = harness();
  const items = Array.from(
    { length: 8 },
    (_, index) => `第 ${index + 1} 項狀態`,
  );
  const result = await app.update({ items });
  expect(result.details).toMatchObject({ items });
  const lines = app.render();
  expect(lines).toHaveLength(10);
  expect(lines.slice(2, -2)).toEqual(
    items.slice(0, 6).map((item) => `• ${item}`),
  );
  expect(lines.at(-2)).toBe("…其餘資訊已截短");
});

test("update_status 彈性整理遊戲資訊、完整替換並依目前分支還原 widget", async () => {
  const app = harness();
  expect([...app.tools.keys()]).toEqual(["update_status"]);
  const tool = app.tools.get("update_status");
  expect(tool?.label).toBe("Update Game Status");
  expect(tool?.description).toContain("不要求固定欄位");
  const itemsSchema = (
    tool?.parameters as
      | {
          properties?: { items?: { minItems?: number; maxItems?: number } };
        }
      | undefined
  )?.properties?.items;
  expect(itemsSchema).toMatchObject({ minItems: 1, maxItems: 8 });
  expect(tool?.promptGuidelines?.join("\n")).toContain(
    "遊玩過程中透過 bears tools 陸續取得新資訊",
  );
  expect(tool?.promptGuidelines?.join("\n")).toContain(
    "不記錄 coding 工作進度",
  );

  await app.event("session_start");
  expect(app.widget.mock.lastCall).toEqual(["llm-status", undefined]);

  const result = await app.update({
    title: " 配裝進度 ",
    items: ["已取得完整背包", "下一步：\n比較武器"],
  });
  expect(result.content[0]).toEqual({
    type: "text",
    text: "遊戲狀態面板已更新（2 項）。",
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
    {
      type: "message",
      message: {
        role: "toolResult",
        toolName: "update_status",
        details: { version: 1, title: "舊版清除", items: [] },
      },
    },
  ]);
  await app.event("session_tree");
  expect(app.widget.mock.lastCall?.[1].join("\n")).toContain("◆ 分支狀態");

  await expect(app.update({ items: [] })).rejects.toThrow(
    "遊戲狀態至少要保留一項最新且有用的資訊。",
  );
  expect(app.widget.mock.lastCall?.[1].join("\n")).toContain("◆ 分支狀態");

  await app.event("session_shutdown");
  expect(app.widget.mock.lastCall).toEqual(["llm-status", undefined]);
});
