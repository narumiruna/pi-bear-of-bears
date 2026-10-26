import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { expect, test, vi } from "vitest";
import goalExtension from "../extensions/goal.js";

function deferred() {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test.each(["tui", "rpc"] as const)(
  "執行中覆蓋Goal：舊tool被取消，idle後新目標只啟動一次（%s）",
  async (mode) => {
    const directory = await mkdtemp(join(tmpdir(), "pi-goal-replace-"));
    let session: AgentSession | undefined;
    try {
      const entered = deferred();
      const completed = deferred();
      const probe = vi.fn(
        (_id: string, _params: unknown, signal?: AbortSignal) =>
          new Promise<{
            content: { type: "text"; text: string }[];
            details: object;
          }>((resolve) => {
            signal?.addEventListener(
              "abort",
              () =>
                resolve({
                  content: [{ type: "text", text: "舊操作已取消" }],
                  details: {},
                }),
              { once: true },
            );
            entered.resolve();
          }),
      );
      const faux = fauxProvider();
      faux.setResponses([
        fauxAssistantMessage(fauxToolCall("replace_probe", {})),
        ...Array.from({ length: 3 }, () =>
          fauxAssistantMessage("obj2測試回覆"),
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
        defaultTools: ["replace_probe"],
        compaction: { enabled: false },
        retry: { enabled: false },
        cacheWarming: "off",
      });
      const resourceLoader = new DefaultResourceLoader({
        cwd: directory,
        agentDir: directory,
        settingsManager,
        noExtensions: true,
        noSkills: true,
        noPromptTemplates: true,
        noThemes: true,
        noContextFiles: true,
        extensionFactories: [
          goalExtension,
          (pi) => {
            pi.registerTool({
              name: "replace_probe",
              label: "可取消測試",
              description: "等取消訊號後才完成",
              parameters: Type.Object({}),
              execute: probe,
            });
          },
        ],
      });
      await resourceLoader.reload();
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
      const states = () =>
        sessionManager
          .getBranch()
          .filter(
            (entry) =>
              entry.type === "custom" && entry.customType === "goal.state",
          )
          .map(
            (entry) =>
              (
                entry as {
                  data: { id: string; objectives: string; status: string };
                }
              ).data,
          );
      let settlements = 0;
      const starts: string[] = [];
      activeSession.subscribe((event) => {
        if (event.type === "agent_start") {
          starts.push(states().at(-1)?.objectives ?? "none");
        }
        if (event.type === "agent_settled" && ++settlements === 2) {
          completed.resolve();
        }
      });
      const onError = vi.fn();
      const unsupported = () => Promise.resolve({ cancelled: true });
      await activeSession.bindExtensions({
        mode,
        commandContextActions: {
          waitForIdle: () => activeSession.waitForIdle(),
          newSession: unsupported,
          fork: unsupported,
          navigateTree: unsupported,
          switchSession: unsupported,
          reload: () => activeSession.reload(),
        },
        onError,
      });
      await activeSession.prompt("/goal obj1");
      await entered.promise;
      expect(activeSession.isIdle).toBe(false);
      const oldId = states().at(-1)?.id;
      await activeSession.prompt("/goal obj2");
      await completed.promise;
      await activeSession.waitForIdle();
      expect(onError).not.toHaveBeenCalled();
      expect(probe).toHaveBeenCalledOnce();
      expect(probe.mock.calls[0][2]?.aborted).toBe(true);
      expect(states()).toContainEqual(
        expect.objectContaining({ id: oldId, status: "stopped" }),
      );
      expect(
        states().filter(
          (state) => state.objectives === "obj2" && state.status === "active",
        ),
      ).toHaveLength(1);
      expect(starts[0]).toBe("obj1");
      expect(starts.slice(1)).toEqual(["obj2", "obj2", "obj2"]);
      expect(faux.state.callCount).toBe(4);
      expect(activeSession.isIdle).toBe(true);
    } finally {
      session?.dispose();
      await rm(directory, { recursive: true, force: true });
    }
  },
  15000,
);
