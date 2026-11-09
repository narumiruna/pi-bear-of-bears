import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  InMemoryCredentialStore,
  InMemoryModelsStore,
} from "@earendil-works/pi-ai";
import {
  type AgentSession,
  createAgentSession,
  createCodemodeExtension,
  DefaultResourceLoader,
  type ExtensionAPI,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { expect, test, vi } from "vitest";
import goalExtension from "../extensions/goal.js";
import reloadExtension from "../extensions/reload-runtime.js";

const cases = (["rpc", "tui"] as const).flatMap((mode) =>
  [false, true].flatMap((goalActive) =>
    [false, true].flatMap((nested) =>
      (nested ? [false, true] : [false]).map((newTool) => ({
        mode,
        goalActive,
        nested,
        newTool,
      })),
    ),
  ),
);

test.each(cases)(
  "正常收尾後reload一次，無aborted訊息（$mode, Goal=$goalActive, nested=$nested, newTool=$newTool）",
  async ({ mode, goalActive, nested, newTool }) => {
    const directory = await mkdtemp(join(tmpdir(), "pi-reload-runtime-"));
    let session: AgentSession | undefined;
    try {
      const faux = fauxProvider();
      const probe = vi.fn(async () => ({
        content: [{ type: "text" as const, text: "不得執行" }],
        details: {},
      }));
      faux.setResponses([
        fauxAssistantMessage(
          fauxToolCall(
            nested ? "codemode" : "reload_runtime",
            nested
              ? {
                  code: "return await tools.reload_runtime({});",
                }
              : {},
          ),
        ),
        ...(nested
          ? [
              newTool
                ? fauxAssistantMessage(fauxToolCall("reload_probe", {}))
                : fauxAssistantMessage("已要求reload，直接結束本回合。"),
            ]
          : []),
        ...Array.from({ length: 3 }, () =>
          fauxAssistantMessage("新runtime已接到continue。"),
        ),
      ]);
      const modelRuntime = await ModelRuntime.create({
        credentials: new InMemoryCredentialStore(),
        modelsStore: new InMemoryModelsStore(),
        modelsPath: null,
        refreshOnCreate: false,
        allowModelNetwork: false,
      });
      modelRuntime.registerNativeProvider(faux.provider);
      const settingsManager = SettingsManager.inMemory({
        defaultTools: [nested ? "codemode" : "reload_runtime", "reload_probe"],
        compaction: { enabled: false },
        retry: { enabled: false },
        cacheWarming: "off",
      });
      const resourceLoader = new DefaultResourceLoader({
        cwd: directory,
        agentDir: directory,
        settingsManager,
        additionalExtensionPaths: [resolve("extensions/reload-runtime.ts")],
        noSkills: true,
        noPromptTemplates: true,
        noThemes: true,
        noContextFiles: true,
        extensionFactories: [
          goalExtension,
          createCodemodeExtension({ models: false }),
          (pi) => {
            pi.registerTool({
              name: "reload_probe",
              label: "測試副作用",
              description: "驗證reload等待中不會執行新工具",
              parameters: Type.Object({}),
              execute: probe,
            });
          },
        ],
      });
      await resourceLoader.reload();
      expect(resourceLoader.getExtensions().errors).toEqual([]);
      const sessionManager = SessionManager.inMemory(directory);
      const created = await createAgentSession({
        cwd: directory,
        agentDir: directory,
        resourceLoader,
        settingsManager,
        sessionManager,
        modelRuntime,
        model: faux.getModel(),
      });
      const activeSession = created.session;
      session = activeSession;
      const sessionId = sessionManager.getSessionId();
      // 真實provider／compaction準備會檢查signal；faux provider原本沒有，漏掉此回歸。
      const prepare = activeSession.agent.prepareNextTurnWithContext;
      activeSession.agent.prepareNextTurnWithContext = (turn, signal) => {
        signal?.throwIfAborted();
        return prepare?.(turn, signal);
      };
      const completedTools: string[] = [];
      const settled: boolean[] = [];
      let finishContinuation = () => {};
      const continued = new Promise<void>((resolve) => {
        finishContinuation = resolve;
      });
      activeSession.subscribe((event) => {
        if (event.type === "tool_execution_end") {
          completedTools.push(event.toolName);
        }
        if (event.type === "agent_settled") {
          settled.push(event.aborted);
          if (settled.length === 2) {
            finishContinuation();
          }
        }
      });
      let finishReload = () => {};
      const reloaded = new Promise<void>((resolve) => {
        finishReload = resolve;
      });
      const reload = vi.fn(async () => {
        expect(activeSession.isIdle).toBe(true);
        expect(completedTools).toEqual([
          "reload_runtime",
          ...(nested ? ["codemode"] : []),
          ...(newTool ? ["reload_probe"] : []),
        ]);
        await activeSession.reload();
        finishReload();
      });
      const onError = vi.fn();
      const unsupported = () => Promise.resolve({ cancelled: true });
      await activeSession.bindExtensions({
        mode,
        commandContextActions: {
          waitForIdle: () => activeSession.waitForIdle(),
          reload,
          newSession: unsupported,
          fork: unsupported,
          navigateTree: unsupported,
          switchSession: unsupported,
        },
        onError,
      });
      await activeSession.sendCustomMessage(
        {
          customType: "test-history",
          content: "重新載入前的對話紀錄",
          display: false,
        },
        { triggerTurn: false },
      );
      await activeSession.prompt(
        goalActive ? "/goal 驗證重新載入" : "請重新載入 Pi runtime",
      );
      await reloaded;
      await continued;
      await activeSession.waitForIdle();

      expect(onError).not.toHaveBeenCalled();
      expect(
        activeSession.messages.filter(
          (message) =>
            message.role === "assistant" &&
            (message.stopReason === "aborted" ||
              message.stopReason === "error"),
        ),
      ).toEqual([]);
      expect(reload).toHaveBeenCalledOnce();
      expect(probe).not.toHaveBeenCalled();
      // 此SDK的codemode不轉送nested terminate，容許一次正常收尾；新工具請求會被阻擋。
      expect(faux.state.callCount).toBe(
        (nested ? 2 : 1) + (goalActive ? 3 : 1),
      );
      expect(settled).toEqual([false, false]);
      expect(
        activeSession.messages.filter(
          (message) =>
            message.role === "user" &&
            JSON.stringify(message).includes("[reload-runtime 自動續行]"),
        ),
      ).toHaveLength(1);
      expect(activeSession.isIdle).toBe(true);
      expect(sessionManager.getSessionId()).toBe(sessionId);
      expect(JSON.stringify(activeSession.messages)).toContain(
        "重新載入前的對話紀錄",
      );
      expect(
        JSON.stringify(
          activeSession.messages.filter((message) => message.role === "user"),
        ),
      ).not.toContain("/reload-runtime");
      const result = activeSession.messages.find(
        (message) =>
          message.role === "toolResult" &&
          message.toolName === (nested ? "codemode" : "reload_runtime"),
      );
      expect(result).toMatchObject(
        nested
          ? {
              nestedCalls: {
                calls: [{ name: "reload_runtime", status: "ok" }],
                complete: true,
              },
            }
          : { details: { status: "queued" } },
      );
      if (goalActive) {
        const state = sessionManager
          .getBranch()
          .filter(
            (entry) =>
              entry.type === "custom" && entry.customType === "goal.state",
          )
          .at(-1);
        expect(state).toMatchObject({ data: { status: "paused" } });
      }
    } finally {
      session?.dispose();
      await rm(directory, { recursive: true, force: true });
    }
  },
  30000,
);

// 外部 Goal 在 settled 派送續行，且完全不認識 runtime:reload-pending。
// 續行刻意有限，讓舊版也會結束測試，而不是以測試 timeout 當唯一證據。
test.each([true, false])(
  "外部 settled 續行不造成永久工具封鎖（Goal先註冊=%s）",
  async (goalFirst) => {
    const directory = await mkdtemp(join(tmpdir(), "pi-reload-competing-"));
    let session: AgentSession | undefined;
    try {
      const faux = fauxProvider();
      const probe = vi.fn(async () => ({
        content: [{ type: "text" as const, text: "新工作工具可用" }],
        details: {},
      }));
      faux.setResponses([
        fauxAssistantMessage(
          fauxToolCall("codemode", {
            code: "return await tools.reload_runtime({});",
          }),
        ),
        fauxAssistantMessage("已要求 reload。"),
        fauxAssistantMessage(fauxToolCall("reload_probe", {})),
        fauxAssistantMessage("新工作完成。"),
        fauxAssistantMessage("不得有額外 reload 續行。"),
      ]);
      let sent = false;
      const competingGoal = (pi: ExtensionAPI) => {
        pi.on("agent_settled", () => {
          if (sent) {
            return;
          }
          sent = true;
          pi.sendUserMessage("外部 Goal 自動續行", { deliverAs: "followUp" });
        });
      };
      const modelRuntime = await ModelRuntime.create({
        credentials: new InMemoryCredentialStore(),
        modelsStore: new InMemoryModelsStore(),
        modelsPath: null,
        refreshOnCreate: false,
        allowModelNetwork: false,
      });
      modelRuntime.registerNativeProvider(faux.provider);
      const settingsManager = SettingsManager.inMemory({
        defaultTools: ["codemode", "reload_probe"],
        compaction: { enabled: false },
        retry: { enabled: false },
        cacheWarming: "off",
      });
      const resourceLoader = new DefaultResourceLoader({
        cwd: directory,
        agentDir: directory,
        settingsManager,
        noSkills: true,
        noPromptTemplates: true,
        noThemes: true,
        noContextFiles: true,
        extensionFactories: [
          ...(goalFirst
            ? [competingGoal, reloadExtension]
            : [reloadExtension, competingGoal]),
          createCodemodeExtension({ models: false }),
          (pi) =>
            pi.registerTool({
              name: "reload_probe",
              label: "新工作測試",
              description: "確認取消 reload 後不再封鎖工具",
              parameters: Type.Object({}),
              execute: probe,
            }),
        ],
      });
      await resourceLoader.reload();
      const created = await createAgentSession({
        cwd: directory,
        agentDir: directory,
        resourceLoader,
        settingsManager,
        sessionManager: SessionManager.inMemory(directory),
        modelRuntime,
        model: faux.getModel(),
      });
      const activeSession = created.session;
      session = activeSession;
      const reload = vi.fn(async () => activeSession.reload());
      const onError = vi.fn();
      const unsupported = () => Promise.resolve({ cancelled: true });
      await activeSession.bindExtensions({
        commandContextActions: {
          waitForIdle: () => activeSession.waitForIdle(),
          reload,
          newSession: unsupported,
          fork: unsupported,
          navigateTree: unsupported,
          switchSession: unsupported,
        },
        onError,
      });
      let finish = () => {};
      const completed = new Promise<void>((resolve) => {
        finish = resolve;
      });
      let settlements = 0;
      activeSession.subscribe((event) => {
        if (event.type === "agent_settled" && ++settlements === 2) {
          finish();
        }
      });
      await activeSession.prompt("請重新載入");
      await completed;
      await activeSession.waitForIdle();
      expect(onError).not.toHaveBeenCalled();
      expect(probe).toHaveBeenCalledOnce();
      // 先排入 Goal 則取消；先排入 reload 則完成載入，再接受新工作。
      expect(reload).toHaveBeenCalledTimes(goalFirst ? 0 : 1);
      // reload 先完成時，其一次 continue 可能先於競爭輸入；不得持續重送。
      expect(faux.state.callCount).toBeGreaterThanOrEqual(4);
      expect(faux.state.callCount).toBeLessThanOrEqual(goalFirst ? 4 : 5);
      expect(activeSession.isIdle).toBe(true);
    } finally {
      session?.dispose();
      await rm(directory, { recursive: true, force: true });
    }
  },
  10000,
);
