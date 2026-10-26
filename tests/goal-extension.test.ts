import {
  createEventBus,
  type ExtensionAPI,
  type ExtensionCommandContext,
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
    events: createEventBus(),
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
          entries: [],
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
  for (let i = 0; i < 2; i++) {
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

test.each([true, false])(
  "回歸：換句話空轉連續三次即斷路，不再無限重送契約（UI=%s）",
  async (hasUI) => {
    const app = harness(hasUI);
    await app.command("goal", "狂戰熊星塔95，打不過就蒐集素材");
    const replies = [
      "本次無新增操作或成果。未找到安全下一步，也未證明全域不可行。",
      "這是續行決策失敗，95層未完成。不能以重複查詢或盲目操作代替。",
      "我仍未找到符合安全限制的新操作，本次沒有新增成果。",
    ];
    expect(app.settle(replies[0])?.continue).toBe(true);
    expect(app.settle(replies[1])?.continue).toBe(true);
    const result = app.settle(replies[2]);
    expect(result?.continue).not.toBe(true);
    expect(app.state().status).toBe("paused");
    expect(result?.entries?.[0].content).toContain("連續 3 次");
    expect(result?.entries?.[0].content).toContain("沒有成功工具執行");
    expect(result?.entries?.[0].content).not.toContain("[goal:complete:");
    expect(app.settle(replies[2])).toBeUndefined();
    app.event("agent_settled", { aborted: false });
    expect(app.sendMessage).toHaveBeenCalledTimes(1);
  },
);

test.each([true, false])(
  "回歸：每次重送都觸發 before_agent_start，相同訊息三次仍停止（UI=%s）",
  async (hasUI) => {
    const app = harness(hasUI);
    await app.command("goal", "工作");
    for (const [index, reply] of [
      "相同回覆",
      " 相同回覆\n",
      "相同回覆",
    ].entries()) {
      app.event("before_agent_start", { prompt: "自動重送的目標契約" });
      app.event("tool_execution_end", { isError: false, result: {} });
      const result = app.settle(reply);
      expect(result?.continue).toBe(index < 2);
      if (index === 2) {
        expect(result?.entries?.at(-1)?.content).toContain("回覆相同");
        expect(result?.entries?.at(-1)?.content).not.toContain(
          "[goal:complete:",
        );
      }
    }
    expect(app.state().status).toBe("paused");
    expect(app.event("before_agent_start")).toBeUndefined();
    expect(app.settle("相同回覆")).toBeUndefined();
    expect(app.sendMessage).toHaveBeenCalledTimes(1);
    await app.command("goal-resume");
    app.event("before_agent_start");
    app.event("tool_execution_end", { isError: false, result: {} });
    expect(app.settle("相同回覆")?.continue).toBe(true);
  },
);

test("跨 Agent 啟動的無工具回覆仍累計三次，不因重送清零", async () => {
  const app = harness();
  await app.command("goal", "工作");
  for (let index = 0; index < 3; index++) {
    app.event("before_agent_start", { prompt: "重送目標" });
    expect(app.settle(`不同回覆 ${index}`)?.continue).toBe(index < 2);
  }
  expect(app.state().status).toBe("paused");
});

test("成功的 nested 工具重設無工具計數；開始或錯誤不重設", async () => {
  const app = harness();
  await app.command("goal", "工作");
  expect(app.settle("第一次")?.continue).toBe(true);
  expect(app.settle("第二次")?.continue).toBe(true);
  app.event("tool_execution_end", {
    parentToolCallId: "outer",
    isError: false,
    result: {},
  });
  expect(app.settle("已取得新觀測")?.continue).toBe(true);
  expect(app.settle("再選候選")?.continue).toBe(true);
  app.event("tool_execution_start", { toolName: "read" });
  app.event("tool_execution_end", { isError: true, result: {} });
  expect(app.settle("還是無法執行")?.continue).toBe(true);
  app.event("tool_execution_end", {
    isError: false,
    result: { isError: true },
  });
  expect(app.settle("沒有成功執行")?.continue).not.toBe(true);
  expect(app.state().status).toBe("paused");
});

test("斷路後可明確恢復，新目標與分支還原不沿用計數", async () => {
  const app = harness();
  await app.command("goal", "舊目標");
  app.settle("一");
  app.settle("二");
  app.settle("三");
  expect(app.state().status).toBe("paused");
  await app.command("goal-resume");
  expect(app.settle("恢復一")?.continue).toBe(true);
  app.event("before_agent_start");
  expect(app.settle("新使用者一")?.continue).toBe(true);
  await app.command("goal", "新目標");
  expect(app.settle("新目標一")?.continue).toBe(true);
  app.event("session_tree");
  expect(app.state().status).toBe("paused");
  await app.command("goal-resume");
  expect(app.settle("分支一")?.continue).toBe(true);
  expect(app.settle("分支二")?.continue).toBe(true);
});

test("斷路門檻不搶先完成驗收，也不計其他 extension 或待送訊息的續行", async () => {
  const app = harness();
  await app.command("goal", "工作");
  app.settle("一");
  app.settle("二");
  expect(app.settle("待送", { continue: true })).toBeUndefined();
  expect(
    app.settle("待送", { context: { pendingMessages: [{}] } }),
  ).toBeUndefined();
  expect(app.state().status).toBe("active");
  expect(
    app.settle(`驗收證據\n[goal:complete:${app.state().id}]`),
  ).toBeUndefined();
  expect(app.state().status).toBe("completed");
});

test("有工具活動且回覆不同時持續續行，不把活動誤稱為驗收", async () => {
  const app = harness(false);
  await app.command("goal", "多步工作");
  for (let attempt = 0; attempt < 20; attempt++) {
    app.event("tool_execution_end", { isError: false, result: {} });
    expect(app.settle(`核對第 ${attempt} 筆，尚未完成`)?.continue).toBe(true);
  }
  expect(app.state().status).toBe("active");
  expect(app.sendMessage).toHaveBeenCalledTimes(1);
});

test("相同回覆的計數在不同回覆後重設，只有本 extension 可用的結算才計數", async () => {
  const app = harness();
  await app.command("goal", "工作");
  for (const reply of ["A", "A", "B", "A", "A"]) {
    app.event("tool_execution_end", { isError: false, result: {} });
    expect(app.settle(reply)?.continue).toBe(true);
  }
  expect(app.settle("A", { continue: true })).toBeUndefined();
  expect(app.state().status).toBe("active");
  app.event("tool_execution_end", { isError: false, result: {} });
  expect(app.settle("A")?.continue).not.toBe(true);
  expect(app.state().status).toBe("paused");
});

test("前置 extension 的 custom 訊息不遮住重複回覆，且保留其 boundary entries", async () => {
  const app = harness();
  await app.command("goal", "工作");
  const other = {
    type: "custom_message",
    customType: "other.audit",
    content: "其他紀錄",
    display: false,
  };
  for (let attempt = 0; attempt < 3; attempt++) {
    app.event("tool_execution_end", { isError: false, result: {} });
    const result = app.settle("", {
      entries: [other],
      context: {
        pendingMessages: [],
        contextMessages: [
          {
            role: "assistant",
            stopReason: "stop",
            content: [{ type: "text", text: "沒有新成果" }],
          },
          { role: "custom", customType: "other.audit", content: "其他紀錄" },
        ],
      },
    });
    expect(result?.entries?.[0]).toEqual(other);
    expect(result?.continue === true).toBe(attempt < 2);
  }
  expect(app.state().status).toBe("paused");
});

test("不跨過 user 或 toolResult 接受先前 assistant 的完成標記", async () => {
  const app = harness();
  await app.command("goal", "工作");
  for (const role of ["user", "toolResult"]) {
    expect(
      app.settle("", {
        context: {
          pendingMessages: [],
          contextMessages: [
            {
              role: "assistant",
              stopReason: "stop",
              content: [
                { type: "text", text: `[goal:complete:${app.state().id}]` },
              ],
            },
            { role, content: [{ type: "text", text: "尚有工作" }] },
            { role: "custom", customType: "other.audit", content: "其他紀錄" },
          ],
        },
      })?.continue,
    ).toBe(true);
  }
  expect(app.state().status).toBe("active");
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
  for (let attempt = 0; attempt < 2; attempt++) {
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

test("回歸：純缺證回覆仍要求獨立評估替代收益，但不能無限重送", async () => {
  const app = harness();
  await app.command("goal", "挑戰高層，打不過就取得素材強化本人");
  const reply = "本次無新增操作或成果。未找到安全下一步，也未證明全域不可行。";
  const contracts = [
    app.sendMessage.mock.calls[0][0].content as string,
    app.event("before_agent_start")?.message?.content ?? "",
  ];
  for (let attempt = 0; attempt < 2; attempt++) {
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
    expect(content).toContain("機率性收益可依合理預期效益作為達標手段");
    expect(content).toContain("單次未取得目標成果，不代表路線無效");
    expect(content).toContain("不將預期當成已取得");
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
    app.event("tool_execution_end", { isError: false, result: {} });
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
