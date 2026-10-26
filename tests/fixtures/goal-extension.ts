import {
  createEventBus,
  type ExtensionAPI,
  type ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { vi } from "vitest";
import extension from "../../extensions/goal.js";

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

export function harness(hasUI = true) {
  const handlers = new Map<string, Handler>();
  const commands = new Map<
    string,
    Parameters<ExtensionAPI["registerCommand"]>[1]
  >();
  let branch: StoredEntry[] = [];
  const sendMessage = vi.fn();
  const registerTool = vi.fn();
  const events = createEventBus();
  const ctx = {
    hasUI,
    isIdle: vi.fn(() => true),
    abort: vi.fn(),
    waitForIdle: vi.fn(() => Promise.resolve()),
    sessionManager: { getBranch: () => branch },
    ui: { notify: vi.fn(), setStatus: vi.fn() },
  } as unknown as ExtensionCommandContext;
  extension({
    events,
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
    events,
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
    entries: () => branch,
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
