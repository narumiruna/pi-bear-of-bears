import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { expect, test, vi } from "vitest";
import type { GameMessage } from "../src/game.js";
import { installLedger, ledgerNeedsIdentity } from "../src/ledger-channel.js";

const fake = vi.hoisted(() => ({
  create: vi.fn(),
  close: vi.fn(async () => {}),
  subscribe: vi.fn(),
}));
vi.mock("../src/telegram.js", () => ({
  createTransport: vi.fn(),
  createWatchConnection: fake.create,
}));

import extension from "../extensions/bears.js";

test("watch starts by default, publishes without triggering an agent turn, and stops on shutdown", async () => {
  let receive!: (message: GameMessage) => void;
  const unsubscribe = vi.fn();
  fake.subscribe.mockImplementation((handler) => {
    receive = handler;
    return unsubscribe;
  });
  fake.create.mockResolvedValue({
    telegramUserId: "999000111333222",
    connect: async () => {},
    subscribe: fake.subscribe,
    close: fake.close,
  });
  const handlers = new Map<
    string,
    (event: unknown, ctx: ExtensionContext) => unknown
  >();
  const sendMessage = vi.fn();
  const command = vi.fn<ExtensionAPI["registerCommand"]>();
  const pi = {
    events: { emit: vi.fn(), on: vi.fn(() => vi.fn()) },
    registerTool: vi.fn(),
    registerCommand: command,
    sendMessage,
    on: (
      name: string,
      handler: (event: unknown, ctx: ExtensionContext) => unknown,
    ) => handlers.set(name, handler),
  } as unknown as ExtensionAPI;
  extension(pi);
  expect(fake.create).not.toHaveBeenCalled();
  const headless = { hasUI: false } as ExtensionContext;
  handlers.get("session_start")?.({}, headless);
  expect(fake.create).not.toHaveBeenCalled();
  const ctx = {
    hasUI: true,
    ui: { setStatus: vi.fn(), notify: vi.fn() },
  } as unknown as ExtensionContext;
  try {
    handlers.get("session_start")?.({}, ctx);
    await vi.waitFor(() => expect(fake.subscribe).toHaveBeenCalledOnce());
    receive({
      id: 1,
      outgoing: false,
      date: 1,
      text: "HP 100/100",
      revision: "a",
      buttons: [],
      hasMedia: false,
    });
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledOnce(), {
      timeout: 2000,
    });
    expect(sendMessage.mock.calls[0][0]).toMatchObject({
      customType: "bears-watch",
      display: true,
    });
    expect(sendMessage.mock.calls[0][1]).toEqual({ triggerTurn: false });
    expect(JSON.stringify(sendMessage.mock.calls)).not.toContain(
      "999000111333222",
    );
    expect(JSON.stringify(sendMessage.mock.calls)).not.toContain(
      "telegramUserId",
    );
    expect(command.mock.calls[0][0]).toBe("bears-watch");
    const handler = command.mock.calls[0][1].handler;
    await handler("off", ctx as Parameters<typeof handler>[1]);
    expect(unsubscribe).toHaveBeenCalledOnce();
    await handler("on", ctx as Parameters<typeof handler>[1]);
    expect(fake.subscribe).toHaveBeenCalledTimes(2);
  } finally {
    await handlers.get("session_shutdown")?.({}, ctx);
  }
  expect(unsubscribe).toHaveBeenCalledTimes(2);
  expect(fake.close).toHaveBeenCalledTimes(2);
});

test("外來 SDK session 的既有 watch 不為另一個 session 帳本讀取身分", async () => {
  const off = installLedger(
    {
      requiresIdentity: true,
      begin: () => {
        throw new Error("不用派送");
      },
      watch: () => {},
      original: () => {},
      operationIds: () => [],
    },
    () => "owner-session",
  );
  const needs: boolean[] = [];
  fake.create.mockResolvedValue({
    connect: () => {
      needs.push(ledgerNeedsIdentity());
      return Promise.resolve();
    },
    subscribe: () => () => {},
    close: () => Promise.resolve(),
  });
  const handlers = new Map<
    string,
    (e: unknown, c: ExtensionContext) => unknown
  >();
  extension({
    events: { emit: vi.fn(), on: () => () => {} },
    registerTool: vi.fn(),
    registerCommand: vi.fn(),
    sendMessage: vi.fn(),
    on: (n: string, h: (e: unknown, c: ExtensionContext) => unknown) =>
      handlers.set(n, h),
  } as unknown as ExtensionAPI);
  const ctx = {
    hasUI: true,
    sessionManager: { getSessionId: () => "foreign-session" },
    ui: { setStatus: vi.fn(), notify: vi.fn() },
  } as unknown as ExtensionContext;
  try {
    handlers.get("session_start")?.({}, ctx);
    await vi.waitFor(() => expect(needs).toHaveLength(1));
    expect(needs).toEqual([false]);
  } finally {
    await handlers.get("session_shutdown")?.({}, ctx);
    off();
  }
});
