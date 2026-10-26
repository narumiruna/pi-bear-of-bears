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
import { expect, test, vi } from "vitest";
import goalExtension from "../extensions/goal.js";

test.each([false, true])(
  "真實 Pi SDK 與 codemode worker：批次結果保存後 reload 一次，不再呼叫模型（Goal=%s）",
  async (goalActive) => {
    const directory = await mkdtemp(join(tmpdir(), "pi-reload-runtime-"));
    let session: AgentSession | undefined;
    try {
      const faux = fauxProvider();
      faux.setResponses([
        fauxAssistantMessage(
          fauxToolCall("codemode", {
            code: "return await tools.reload_runtime({});",
          }),
        ),
        fauxAssistantMessage("不應出現的後續模型回覆"),
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
        defaultTools: ["codemode"],
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
      const completedTools: string[] = [];
      activeSession.subscribe((event) => {
        if (event.type === "tool_execution_end") {
          completedTools.push(event.toolName);
        }
      });
      let finishReload = () => {};
      const reloaded = new Promise<void>((resolve) => {
        finishReload = resolve;
      });
      const reload = vi.fn(async () => {
        expect(activeSession.isIdle).toBe(true);
        expect(completedTools).toEqual(["reload_runtime", "codemode"]);
        await activeSession.reload();
        finishReload();
      });
      const onError = vi.fn();
      const unsupported = () => Promise.resolve({ cancelled: true });
      await activeSession.bindExtensions({
        mode: "rpc",
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
      expect(reload).toHaveBeenCalledOnce();
      expect(faux.state.callCount).toBe(1);
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
      expect(
        activeSession.messages.find(
          (message) =>
            message.role === "toolResult" && message.toolName === "codemode",
        ),
      ).toMatchObject({
        nestedCalls: {
          calls: [{ name: "reload_runtime", status: "ok" }],
          complete: true,
        },
      });
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
