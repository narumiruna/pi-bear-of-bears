import { readFileSync } from "node:fs";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { expect, test, vi } from "vitest";
import { CHARACTER_MESSAGES_EVENT } from "../src/character-status.js";
import { WATCH_STATUS_EVENT } from "../src/watch.js";

const fake = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("../src/telegram.js", () => ({ createTransport: fake.create }));

import extension from "../extensions/character-status.js";

const text = readFileSync(
  new URL("./fixtures/character-status.txt", import.meta.url),
  "utf8",
);

test("widget initializes through history only and updates independently of agent turns", async () => {
  const message = {
    id: 1,
    date: 1788772908,
    revision: "a",
    outgoing: false,
    text,
  };
  const transport = {
    connect: vi.fn(async () => {}),
    history: vi.fn(async () => [message]),
    close: vi.fn(async () => {}),
    send: vi.fn(),
    click: vi.fn(),
  };
  fake.create.mockResolvedValue(transport);
  const handlers = new Map<
    string,
    (event: unknown, ctx: ExtensionContext) => unknown
  >();
  const listeners = new Map<string, (value: unknown) => void>();
  const unsubscribe = vi.fn(() => listeners.clear());
  const widget = vi.fn();
  const ctx = {
    hasUI: true,
    mode: "rpc",
    ui: { setWidget: widget },
  } as unknown as ExtensionContext;
  const command = vi.fn<ExtensionAPI["registerCommand"]>();
  const pi = {
    registerCommand: command,
    on: (
      name: string,
      handler: (event: unknown, ctx: ExtensionContext) => unknown,
    ) => handlers.set(name, handler),
    events: {
      emit: vi.fn(),
      on: (name: string, handler: (value: unknown) => void) => {
        listeners.set(name, handler);
        return unsubscribe;
      },
    },
  } as unknown as ExtensionAPI;
  extension(pi);
  expect(fake.create).not.toHaveBeenCalled();
  handlers.get("session_start")?.({}, ctx);
  await vi.waitFor(() => expect(transport.close).toHaveBeenCalledOnce());
  expect(widget.mock.lastCall?.[2]).toEqual({ placement: "aboveEditor" });
  expect(widget.mock.lastCall?.[1].join("\n")).toContain("法熊 Lv10");
  expect(transport.history).toHaveBeenCalledWith(30, undefined);
  expect(transport.send).not.toHaveBeenCalled();
  expect(transport.click).not.toHaveBeenCalled();
  listeners.get(CHARACTER_MESSAGES_EVENT)?.([
    { ...message, id: 2, text: text.replaceAll("Lv10", "Lv11") },
  ]);
  expect(widget.mock.lastCall?.[1].join("\n")).toContain("法熊 Lv11");
  listeners.get(WATCH_STATUS_EVENT)?.("disconnected");
  expect(widget.mock.lastCall?.[1].join("\n")).toContain("disconnected");
  const handler = command.mock.calls[0][1].handler;
  await handler("full", ctx as Parameters<typeof handler>[1]);
  expect(widget.mock.lastCall?.[1].join("\n")).toContain("詳細");
  expect(transport.history).toHaveBeenCalledOnce();
  await handlers.get("session_shutdown")?.({}, ctx);
  expect(unsubscribe).toHaveBeenCalledTimes(2);
  expect(widget.mock.lastCall).toEqual(["bears-character-status", undefined]);
});
