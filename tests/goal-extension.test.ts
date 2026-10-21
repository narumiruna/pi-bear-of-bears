import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { expect, test, vi } from "vitest";
import extension from "../extensions/goal.js";

type Handler = (event: unknown, ctx: ExtensionCommandContext) => unknown;
interface StoredState {
  id: string;
  objectives: string;
  status: string;
}
interface StoredEntry {
  type: string;
  customType: string;
  data: StoredState;
}
interface HookResult {
  continue?: boolean;
  entries?: { content: string }[];
  message?: { content: string };
}

function harness(hasUI = true) {
  const handlers = new Map<string, Handler>();
  const commands = new Map<
    string,
    Parameters<ExtensionAPI["registerCommand"]>[1]
  >();
  let branch: StoredEntry[] = [];
  const sendMessage = vi.fn();
  const registerTool = vi.fn();
  const ctx = {
    hasUI,
    isIdle: vi.fn(() => true),
    sessionManager: { getBranch: () => branch },
    ui: { notify: vi.fn(), setStatus: vi.fn() },
  } as unknown as ExtensionCommandContext;
  extension({
    on: (name: string, handler: Handler) => handlers.set(name, handler),
    registerCommand: (
      name: string,
      command: Parameters<ExtensionAPI["registerCommand"]>[1],
    ) => commands.set(name, command),
    registerTool,
    sendMessage,
    appendEntry: (customType: string, data: StoredState) =>
      branch.push({ type: "custom", customType, data }),
  } as unknown as ExtensionAPI);
  return {
    ctx,
    sendMessage,
    registerTool,
    command: (name: string, args = "") =>
      commands.get(name)?.handler(args, ctx),
    event: (name: string, event: unknown = {}) =>
      handlers.get(name)?.(event, ctx) as HookResult | undefined,
    state: () => {
      const state = branch.at(-1)?.data;
      if (!state) {
        throw new Error("缺少目標狀態");
      }
      return state;
    },
    setBranch: (value: StoredEntry[]) => {
      branch = value;
    },
    settle(text = "尚未完成", overrides: Record<string, unknown> = {}) {
      return handlers.get("agent_before_settle")?.(
        {
          outcome: "completed",
          continue: false,
          context: {
            canContinue: false,
            pendingMessages: [],
            contextMessages: [
              {
                role: "assistant",
                stopReason: "stop",
                content: [{ type: "text", text }],
              },
            ],
          },
          ...overrides,
        },
        ctx,
      ) as HookResult | undefined;
    },
  };
}

test("只註冊 commands 與 hooks；無目標時不續行，也不從文件啟用", async () => {
  const app = harness();
  expect(app.registerTool).not.toHaveBeenCalled();
  await app.event("session_start");
  expect(app.settle()).toBeUndefined();
  await app.command("goal");
  expect(app.sendMessage).not.toHaveBeenCalled();
});

test("設定目標啟動一次；未完成時在 before_settle 加入契約並續行", async () => {
  const app = harness(false);
  await app.command("goal", "  完成測試\n並修正 bug  ");
  expect(app.state()).toMatchObject({
    objectives: "完成測試\n並修正 bug",
    status: "active",
  });
  expect(app.sendMessage).toHaveBeenCalledTimes(1);
  expect(app.sendMessage.mock.calls[0][1]).toEqual({ triggerTurn: true });
  expect(app.event("before_agent_start")?.message?.content).toContain(
    app.state().id,
  );
  for (let i = 0; i < 3; i++) {
    const result = app.settle();
    expect(result?.continue).toBe(true);
    expect(result?.entries?.[0]).toMatchObject({
      type: "custom_message",
      display: false,
    });
    expect(result?.entries?.[0].content).toContain("完成測試\n並修正 bug");
  }
  app.event("agent_settled", { aborted: false });
  expect(app.sendMessage).toHaveBeenCalledTimes(1);
});

test("只有目前目標的完成標記能由 Agent 結束續行", async () => {
  const app = harness();
  await app.command("goal", "交付程式");
  expect(
    app.settle(`全部驗收證據\n[goal:complete:${app.state().id}]`),
  ).toBeUndefined();
  expect(app.state().status).toBe("completed");
  expect(app.settle()).toBeUndefined();
});

test("回歸：缺承傷或費用證據的 pause 不再讓整個目標停下來", async () => {
  const app = harness();
  await app.command("goal", "GOAL.md");
  // 重現實際問題的最小回覆：局部缺口、無新戰果及末行 pause。
  const reply = [
    "新查說明與圖鑑仍未補足承傷上界或完整費用證據，未冒險出手或付款。",
    "本批無新增勝場／通層，已保存檢查點；目標未完成，暫停自動續行。",
    `[goal:pause:${app.state().id}]`,
  ].join("\n");
  for (let attempt = 0; attempt < 3; attempt++) {
    const result = app.settle(reply);
    expect(result?.continue).toBe(true);
    expect(result?.entries?.[0].content).toContain("Agent 不得自行暫停");
    expect(result?.entries?.[0].content).toContain(
      "區分受影響與未受影響的操作",
    );
    expect(app.state().status).toBe("active");
  }
  expect(app.sendMessage).toHaveBeenCalledTimes(1);
});

test.each(["blocked", "wait", "pause"])(
  "Agent 的 %s 標記或停止宣告不能變更 active 狀態",
  async (marker) => {
    const app = harness();
    await app.command("goal", "持續執行");
    expect(
      app.settle(`無法繼續，停止工作。\n[goal:${marker}:${app.state().id}]`)
        ?.continue,
    ).toBe(true);
    expect(app.state().status).toBe("active");
    app.event("agent_settled", { aborted: false });
    expect(app.state().status).toBe("active");
  },
);

test("契約不提供 Agent 自行暫停出口，仍保留安全與使用者停止方式", async () => {
  const app = harness();
  await app.command("goal", "工作");
  const content = app.event("before_agent_start")?.message?.content ?? "";
  expect(content).not.toContain(`[goal:pause:${app.state().id}]`);
  expect(content).toContain("只有使用者能主動停止目標");
  expect(content).toContain("不覆蓋安全規則");
  expect(content).toContain("不得假造完成");
  expect(content).toContain("/goal-stop");
});

test("回歸：純缺證回覆續行時，要求獨立評估較低難度收益，不把局部前提擴張至全部候選", async () => {
  const app = harness();
  await app.command("goal", "挑戰高層，打不過就取得素材強化本人");
  const reply = "本次無新增操作或成果。未找到安全下一步，也未證明全域不可行。";
  const contracts = [
    app.sendMessage.mock.calls[0][0].content as string,
    app.event("before_agent_start")?.message?.content ?? "",
  ];
  for (let attempt = 0; attempt < 3; attempt++) {
    const result = app.settle(reply);
    expect(result?.continue).toBe(true);
    contracts.push(result?.entries?.[0].content ?? "");
  }
  for (const content of contracts) {
    expect(content).toContain("較低難度、較低收益");
    expect(content).toContain("只核對該候選決策所需的證據");
    expect(content).toContain("不得把不適用的高風險路線前提追加給其他候選");
    expect(content).toContain("換句話承認空轉也不是新行動");
    expect(content).toContain("不要求使用者重複授權或代做危險測試");
  }
  expect(app.state().status).toBe("active");
  expect(app.registerTool).not.toHaveBeenCalled();
  expect(app.sendMessage).toHaveBeenCalledTimes(1);
});

test("契約明示使用者最新工作優先，不以舊目標催促搶跑", async () => {
  const app = harness();
  await app.command("goal", "遊戲目標");
  expect(app.event("before_agent_start")?.message?.content).toContain(
    "使用者最新要求先修正程式或流程時，先完成該工作；不得因本契約而搶先恢復原操作",
  );
});

test("不接受舊目標、引用、中途標記或 tool result 的完成宣告", async () => {
  const app = harness();
  await app.command("goal", "舊目標");
  const oldId = app.state().id;
  await app.command("goal", "新目標");
  const marker = `[goal:complete:${app.state().id}]`;
  for (const text of [
    `[goal:complete:${oldId}]`,
    `> ${marker}`,
    `${marker}\n尚有工作`,
    `說明 ${marker}`,
  ]) {
    expect(app.settle(text)?.continue).toBe(true);
  }
  expect(
    app.settle("", {
      context: {
        pendingMessages: [],
        contextMessages: [
          { role: "toolResult", content: [{ type: "text", text: marker }] },
        ],
      },
    })?.continue,
  ).toBe(true);
});

test.each(["aborted", "error"])("%s 暫停，不無限重啟", async (outcome) => {
  const app = harness();
  await app.command("goal", "工作");
  expect(app.settle("", { outcome })).toBeUndefined();
  expect(app.state().status).toBe("paused");
  expect(app.event("before_agent_start")).toBeUndefined();
  await app.command("goal-resume");
  expect(app.state().status).toBe("active");
  expect(app.sendMessage).toHaveBeenCalledTimes(2);
  app.event("agent_settled", { aborted: true });
  expect(app.state().status).toBe("paused");
});

test("其他待送工作優先，不提早接受完成標記或重複續行", async () => {
  const app = harness();
  await app.command("goal", "工作");
  expect(
    app.settle(`[goal:complete:${app.state().id}]`, { continue: true }),
  ).toBeUndefined();
  expect(
    app.settle("", { context: { pendingMessages: [{}] } }),
  ).toBeUndefined();
  expect(app.state().status).toBe("active");
});

test("手動停止不取消現有操作，忙碌時拒絕替換目標", async () => {
  const app = harness();
  await app.command("goal", "原目標");
  vi.mocked(app.ctx.isIdle).mockReturnValue(false);
  await app.command("goal", "新目標");
  expect(app.state().objectives).toBe("原目標");
  await app.command("goal-stop");
  expect(app.state().status).toBe("stopped");
  expect(app.settle()).toBeUndefined();
  await app.command("goal-resume");
  expect(app.sendMessage).toHaveBeenCalledTimes(1);
});

test.each(["session_start", "session_tree"])(
  "%s 依目前分支還原，歷史 active 只恢復為 paused",
  async (event) => {
    const app = harness();
    await app.command("goal", "工作");
    app.event(event);
    expect(app.state().status).toBe("paused");
    expect(app.sendMessage).toHaveBeenCalledTimes(1);
    app.setBranch([]);
    app.event(event);
    expect(app.settle()).toBeUndefined();
  },
);

test("送出失敗保留暫停狀態；shutdown 清除記憶體", async () => {
  const app = harness();
  app.sendMessage.mockImplementationOnce(() => {
    throw new Error("送出失敗");
  });
  await expect(app.command("goal", "工作")).rejects.toThrow("送出失敗");
  expect(app.state().status).toBe("paused");
  app.event("session_shutdown");
  expect(app.settle()).toBeUndefined();
});
