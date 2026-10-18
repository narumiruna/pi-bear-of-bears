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
    appendEntry: (customType: string, data: unknown) => {
      branch.push({ type: "custom", customType, data });
    },
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
    render(
      width = 72,
      theme = {
        fg: (_color: string, text: string) => text,
        bold: (text: string) => text,
      },
    ): string[] {
      const value = widget.mock.lastCall?.[1];
      if (typeof value === "function") {
        return value({}, theme).render(width);
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

test("codemode 巢狀更新以 custom entry 還原，不依賴頂層 toolResult", async () => {
  const app = harness();
  expect(app.tools.get("update_status")?.exposure).toBe("codemode");
  await app.update({ items: ["巢狀工具取得的新觀測"] });
  await app.event("session_start");
  expect(app.render().join("\n")).toContain("巢狀工具取得的新觀測");
});

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
    expect(lines.join("\n")).not.toContain("未顯示");
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
    expect(lines.length).toBeLessThanOrEqual(10);
    expect(lines.at(-2)).toMatch(/^…另有 \d+ 項未顯示$/);
    expect(lines.every((line) => visibleWidth(line) <= 72)).toBe(true);
  },
);

test("八項資訊仍完整保存，超出 10 行只省略畫面項目", async () => {
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
  expect(lines.at(-2)).toBe("…另有 2 項未顯示");
});

test("自由內容保留多角色歸屬與動態資訊，切角後可還原完整替代內容", async () => {
  const app = harness();
  const initial = await app.update({
    title: "目前角色：なるみ",
    items: [
      "目標｜全體：9 名角色達到 70 層",
      "保留：聚能神手 +5，維持鎖定",
      "發現：新機制待驗證",
    ],
  });
  const next = {
    title: "目前角色：角色 B",
    items: [
      "目標｜全體：9 名角色達到 70 層",
      "缺口：入場材料不足",
      "保留｜なるみ：最後觀測聚能神手 +5 已鎖定",
      "未分類的臨時資訊也可保留",
    ],
  };
  const result = await app.update(next);
  expect(result.details).toEqual({ version: 1, ...next });
  await app.event("session_start");
  const text = app.render().join("\n");
  expect(text).toContain("◆ 目前角色：角色 B");
  for (const item of next.items) {
    expect(text).toContain(item);
  }
  expect(text).not.toContain("新機制待驗證");

  app.setBranch([
    { type: "custom", customType: "bears.status", data: initial.details },
  ]);
  await app.event("session_tree");
  expect(app.render().join("\n")).toContain("◆ 目前角色：なるみ");
  expect(app.render().join("\n")).not.toContain("角色 B");
});

test.each(["rpc", "tui"] as const)(
  "%s 簡明面板由標題指定本角，保留跨角色歸屬與動態標籤",
  async (mode) => {
    const app = harness(mode);
    const items = [
      "目標：星塔 70 層；目前最高 65 層",
      "全體進度：最後觀測 9 名角色均未達 70 層",
      "現況：霜風避難所，手動操作；HP／MP 全滿",
      "資金：80,446,791 G",
      "材料：最後觀測精魄 15,806 個、通用碎片 4 個",
      "待確認｜角色 B：最後觀測入場材料不足",
    ];
    const result = await app.update({ title: "なるみ｜賢者熊", items });
    expect(result.details).toMatchObject({ items });
    const lines = app.render();
    expect(lines.slice(1, -1)).toEqual([
      "◆ なるみ｜賢者熊",
      ...items.map((item) => `• ${item}`),
    ]);
    expect(lines.join("\n").match(/なるみ/gu)).toHaveLength(1);

    await app.event("session_start");
    expect(app.render()).toEqual(lines);
  },
);

test("生成規則要求歸屬、時效與可讀性，但不新增固定遊戲欄位", () => {
  const tool = harness().tools.get("update_status");
  const schema = tool?.parameters as
    | { properties?: Record<string, unknown> }
    | undefined;
  expect(Object.keys(schema?.properties ?? {})).toEqual(["title", "items"]);
  const guidelines = tool?.promptGuidelines?.join("\n");
  for (const rule of [
    "目前操作角色",
    "每項只說一個主題",
    "自由標籤：內容",
    "本角項目不重複角色名稱",
    "只有跨角色或全體資訊另標歸屬",
    "標題未確認角色時，不得省略角色歸屬",
    "不要求固定分類",
    "完整物品名稱與必要數量",
    "不為縮短行數而省略必要文字或安全條件",
    "屬性只在影響目前配裝或戰鬥決策時顯示",
    "目前狀態、歷史支出與下一步分項表達",
    "歷史支出只在影響剩餘預算或後續決策時保留",
    "HP 與 MP 都已確認全滿",
    "未確認共用的資源不得列為帳號資源",
    "進度分子與分母須說明計算對象",
    "不把前角的裝備、資源或生命值套用到新角色",
    "最後觀測",
    "待驗證",
    "已解除的臨時限制",
    "通常 4 至 6 項",
  ]) {
    expect(guidelines).toContain(rule);
  }
});

test("長項目的續行縮排，完整項目放不下時顯示未顯示項數", async () => {
  const app = harness("tui");
  const longItem = "x".repeat(132);
  await app.update({
    items: ["優先資訊", longItem, "較低優先資訊"],
  });
  const narrow = app.render(24);
  expect(narrow.slice(1, -1)).toEqual([
    "◆ 遊戲狀態",
    "• 優先資訊",
    "…另有 2 項未顯示",
  ]);
  expect(narrow.join("\n")).not.toContain("xxx");

  const wide = app.render(72);
  expect(wide.slice(2, -1)).toEqual([
    "• 優先資訊",
    `• ${"x".repeat(70)}`,
    `  ${"x".repeat(62)}`,
    "• 較低優先資訊",
  ]);
  expect(wide.join("\n")).not.toContain("未顯示");
});

test("自由標籤依主題著色，不依賴固定分類", async () => {
  const app = harness("tui");
  await app.update({
    items: ["臨時發現｜角色 B：新線索待驗證", "沒有標籤的資訊"],
  });
  const fg = vi.fn((_color: string, text: string) => text);
  app.render(72, { fg, bold: (text) => text });
  expect(fg).toHaveBeenCalledWith("muted", "臨時發現｜角色 B：");
  expect(fg).not.toHaveBeenCalledWith("muted", "沒有標籤的資訊");
});

test.each([0, 1, 2, 3, 12, 24, 72, 120])(
  "寬度 %i 下 CJK、emoji 與 ANSI 內容不超出寬度或 10 行上限",
  async (width) => {
    const app = harness("tui");
    await app.update({
      title: "目前角色：なるみ｜主要目標與較長說明",
      items: [
        "發現｜なるみ：寬字🐻".repeat(8),
        "待確認｜角色 B：最後觀測入場材料不足",
      ],
    });
    const lines = app.render(width, {
      fg: (_color, text) => `\x1b[36m${text}\x1b[39m`,
      bold: (text) => `\x1b[1m${text}\x1b[22m`,
    });
    expect(lines.length).toBeLessThanOrEqual(10);
    expect(lines.every((line) => visibleWidth(line) <= width)).toBe(true);
    if (width === 0) {
      expect(lines).toEqual([]);
    }
  },
);

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
