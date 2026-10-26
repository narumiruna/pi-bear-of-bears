import { randomUUID } from "node:crypto";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { vi } from "vitest";
import { type BotTransport, Game, type GameMessage } from "../../src/game.js";
import { installLedger, withLedgerCall } from "../../src/ledger-channel.js";
import { projectLedger } from "../../src/ledger-projection.js";
import { LedgerRuntime } from "../../src/ledger-runtime.js";
import { LedgerStore } from "../../src/ledger-store.js";
import type { LedgerReference } from "../../src/ledger-types.js";
import { message, statusText } from "./workflow.js";

export const skillText = (
  cost = 32,
  tail = "",
) => `✨ 使用技能：血怒亂斬（MP -${cost}）
💨 合成星影 搶得先機！
你受到 500 點傷害。HP：500/1000
造成 100 點傷害！🐻 HP：900/1000
🩸 神話吸血 +300　HP：800/1000
💚 恢復 600 HP！HP：1000/1000

🐻 反擊！你受到 500 傷害。HP：500/1000${tail}`;
/** 全部為合成離線協定，不是即時遊戲或私人資料匯入。 */
export function ledgerHarness(namespace = "test") {
  const directory = mkdtempSync(
    join(realpathSync(tmpdir()), "bears-ledger-test-"),
  );
  const store = new LedgerStore(directory, namespace);
  let references: LedgerReference[] = [];
  const runtime = new LedgerRuntime(store, {
    session: () => "test-session",
    references: () => references,
    publish: (ref) => {
      references.push(ref);
    },
  });
  let uninstall: (() => void) | undefined;
  const messages: GameMessage[] = [];
  let response: string[] = [],
    nextId = 1;
  const add = (text: string, outgoing = false) => {
    const m = message(nextId++, text, outgoing);
    messages.push(m);
    return m;
  };
  const bot: BotTransport = {
    telegramUserId: "100000001",
    connect: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    history: vi.fn(async (limit, beforeId) =>
      messages
        .filter((m) => beforeId === undefined || m.id < beforeId)
        .slice(-limit),
    ),
    message: vi.fn(async (id) => messages.find((m) => m.id === id)),
    send: vi.fn((text) => {
      add(text, true);
      for (const text of response) {
        add(text);
      }
      return Promise.resolve();
    }),
    click: vi.fn(async () => undefined),
  };
  const factory = vi.fn(async () => bot),
    game = new Game(factory, 0, 1000);
  const act = (command: string, text: string | string[] = skillText()) => {
    response = Array.isArray(text) ? text : [text];
    return withLedgerCall(
      { toolCallId: randomUUID(), toolName: "bears_send" },
      () => game.act({ text: command }),
    );
  };
  return {
    directory,
    store,
    runtime,
    bot,
    factory,
    game,
    messages,
    add,
    act,
    install: (session?: () => string) => {
      uninstall = installLedger(runtime, session);
    },
    seed: (name = "測試熊", mp = 100) => {
      const m = add(statusText(name, 1000, mp));
      runtime.watch([m], 0);
      return m;
    },
    projection: (name?: string) => projectLedger(runtime.read(), name),
    references: () => [...references],
    branch: (refs: LedgerReference[]) => {
      references = refs;
      runtime.reset();
    },
    close: () => {
      uninstall?.();
      runtime.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
