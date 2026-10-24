import { setTimeout as sleep } from "node:timers/promises";
import { currentDispatchCheck, withGameOperation } from "./game-operation.js";
import { withRpcPhase } from "./rpc-diagnostics.js";

export interface GameButton {
  row: number;
  column: number;
  text: string;
  kind: "callback" | "text" | "unsupported";
}

export interface GameMessage {
  id: number;
  outgoing: boolean;
  text: string;
  date: number;
  revision: string;
  buttons: GameButton[];
  hasMedia: boolean;
}

/** 依陣列由尾往前找第一則可解析的 bot 回覆；不重新排序或略過 false／0。 */
export function latestParsed<T>(
  messages: readonly GameMessage[],
  parser: (text: string) => T | undefined,
) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message.outgoing) {
      const parsed = parser(message.text);
      if (parsed !== undefined) {
        return parsed;
      }
    }
  }
}

export interface ButtonSelection {
  messageId: number;
  revision: string;
  row: number;
  column: number;
}

export interface BotTransport {
  connect: () => Promise<void>;
  history: (limit: number, beforeId?: number) => Promise<GameMessage[]>;
  message: (id: number) => Promise<GameMessage | undefined>;
  send: (text: string, signal: AbortSignal) => Promise<void>;
  click: (
    selection: ButtonSelection,
    signal: AbortSignal,
  ) => Promise<string | undefined>;
  close: () => Promise<void>;
}

export function selectedButton(
  message: GameMessage | undefined,
  selection: ButtonSelection,
) {
  if (!message || message.outgoing || message.revision !== selection.revision) {
    throw new Error(
      "Message missing or changed. Read bears_history and choose again.",
    );
  }
  const button = message.buttons.find(
    (item) => item.row === selection.row && item.column === selection.column,
  );
  if (!button || button.kind === "unsupported") {
    throw new Error(
      "Only ordinary text and callback buttons are supported; URLs, payments, login, phone and location requests are blocked.",
    );
  }
  return button;
}

function interrupted<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    work
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", abort));
  });
}

export class Game {
  private busy = false;
  private stopped = false;
  private active?: AbortController;

  constructor(
    private readonly createTransport: () => Promise<BotTransport>,
    private readonly replyWaitMs = 1500,
    private readonly timeoutMs = 30_000,
  ) {}

  stop() {
    this.stopped = true;
    this.active?.abort(
      new Error("Telegram operation cancelled by session shutdown."),
    );
  }

  private run<T>(
    operation: (
      bot: BotTransport,
      signal: AbortSignal,
      markSent: () => void,
    ) => Promise<T>,
    callerSignal?: AbortSignal,
    action = false,
  ) {
    return withGameOperation(() =>
      this.runUnlocked(operation, callerSignal, action),
    );
  }

  private async runUnlocked<T>(
    operation: (
      bot: BotTransport,
      signal: AbortSignal,
      markSent: () => void,
    ) => Promise<T>,
    callerSignal?: AbortSignal,
    action = false,
  ) {
    callerSignal?.throwIfAborted();
    if (this.stopped) {
      throw new Error("This game session has shut down.");
    }
    if (this.busy) {
      throw new Error(
        "A Telegram operation is already running. Use one bears tool at a time.",
      );
    }
    this.busy = true;
    const controller = new AbortController();
    this.active = controller;
    const abort = () =>
      controller.abort(new Error("Telegram operation cancelled."));
    callerSignal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(
      () => controller.abort(new Error("Telegram operation timed out.")),
      this.timeoutMs,
    );
    let bot: BotTransport | undefined;
    let sent = false;
    let phase: "connect" | "operation" = "connect";
    try {
      // Factory only reads local configuration; no network before connect.
      bot = await this.createTransport();
      controller.signal.throwIfAborted();
      const transport = bot;
      return await interrupted(
        (async () => {
          await withRpcPhase("connect", () => transport.connect());
          controller.signal.throwIfAborted();
          phase = "operation";
          return operation(transport, controller.signal, () => {
            sent = true;
          });
        })(),
        controller.signal,
      );
    } catch (error) {
      const seconds = (error as { seconds?: unknown } | null)?.seconds;
      const rateLimit =
        typeof seconds === "number" && Number.isFinite(seconds) && seconds > 0
          ? `Telegram rate limit: wait ${seconds} seconds before any further requests. `
          : "";
      // 只保留 teleproto 的 RPC 方法名，不將原始診斷內容加到唯讀限流訊息。
      const rpc =
        error instanceof Error
          ? /\(caused by ([A-Za-z][A-Za-z0-9]{0,39}\.[A-Za-z][A-Za-z0-9]{0,79})\)$/u.exec(
              error.message,
            )?.[1]
          : undefined;
      const context = rateLimit
        ? ` Rate-limit phase: ${phase}${rpc ? `; RPC: ${rpc}` : ""}.`
        : "";
      if (sent) {
        throw new Error(
          `${rateLimit}Action may have reached the bot; outcome is unknown. Do not retry it. Read bears_history before deciding what to do next.${context}`,
          { cause: error },
        );
      }
      if (action) {
        const detail =
          error instanceof Error ? error.message : "Telegram operation failed.";
        throw new Error(
          `${rateLimit}Action was not dispatched to the bot. ${detail}${context}`,
          { cause: error },
        );
      }
      if (rateLimit) {
        throw new Error(`${rateLimit.trim()}${context}`, { cause: error });
      }
      throw error;
    } finally {
      clearTimeout(timer);
      callerSignal?.removeEventListener("abort", abort);
      if (bot) {
        const transport = bot;
        // Do not let socket teardown hold the pi tool indefinitely.
        await Promise.race([
          withRpcPhase("close", () => transport.close()).catch(() => undefined),
          sleep(1000),
        ]);
      }
      this.active = undefined;
      this.busy = false;
    }
  }

  history(limit = 10, beforeId?: number, signal?: AbortSignal) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 30) {
      throw new Error("limit must be 1–30.");
    }
    if (
      beforeId !== undefined &&
      (!Number.isInteger(beforeId) || beforeId < 1)
    ) {
      throw new Error("beforeId must be positive.");
    }
    return this.run(
      (bot) => withRpcPhase("history", () => bot.history(limit, beforeId)),
      signal,
    );
  }

  act(action: { text: string } | ButtonSelection, signal?: AbortSignal) {
    if (
      "text" in action &&
      (!action.text.trim() || action.text.length > 4096)
    ) {
      throw new Error("Send 1–4096 characters of plain text.");
    }
    return this.run(
      async (bot, operationSignal, markSent) => {
        const check = currentDispatchCheck();
        const before = await withRpcPhase("before_history", () =>
          bot.history(check ? 30 : 10),
        );
        operationSignal.throwIfAborted();
        check?.(before, action);
        if (!("text" in action)) {
          selectedButton(
            await withRpcPhase("button_validation", () =>
              bot.message(action.messageId),
            ),
            action,
          );
          operationSignal.throwIfAborted();
        }
        markSent();
        const acknowledgement = await withRpcPhase("dispatch", async () => {
          if ("text" in action) {
            await bot.send(action.text, operationSignal);
            return;
          }
          return bot.click(action, operationSignal);
        });
        await sleep(this.replyWaitMs, undefined, { signal: operationSignal });
        operationSignal.throwIfAborted();
        const messages = await withRpcPhase("after_history", () =>
          bot.history(10),
        );
        const changes = messages.filter(
          (message) =>
            !(
              message.outgoing ||
              before.some(
                (old) =>
                  old.id === message.id && old.revision === message.revision,
              )
            ),
        );
        return {
          delivery: "submitted",
          observation:
            changes.length > 0 ? "bot_updates_observed" : "no_update_yet",
          acknowledgement,
          messages: changes,
          note: "Updates may be unrelated or incomplete. This does not prove action success. Use bears_history for late replies; never blindly resend.",
        };
      },
      signal,
      true,
    );
  }
}
