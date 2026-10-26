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
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { expect, test, vi } from "vitest";
import goalExtension from "../extensions/goal.js";

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
        newTool
          ? fauxAssistantMessage(fauxToolCall("reload_probe", {}))
          : fauxAssistantMessage("已要求reload，直接結束本回合。"),
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
      activeSession.subscribe((event) => {
        if (event.type === "tool_execution_end") {
          completedTools.push(event.toolName);
        }
        if (event.type === "agent_settled") {
          settled.push(event.aborted);
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
      expect(faux.state.callCount).toBe(nested ? 2 : 1);
      expect(settled).toEqual([false]);
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
