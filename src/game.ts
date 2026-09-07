import { setTimeout as sleep } from "node:timers/promises";

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

export interface ButtonSelection {
  messageId: number;
  revision: string;
  row: number;
  column: number;
}

export interface BotTransport {
  connect(): Promise<void>;
  history(limit: number, beforeId?: number): Promise<GameMessage[]>;
  message(id: number): Promise<GameMessage | undefined>;
  send(text: string, signal: AbortSignal): Promise<void>;
  click(
    selection: ButtonSelection,
    signal: AbortSignal,
  ): Promise<string | undefined>;
  close(): Promise<void>;
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
    private readonly timeoutMs = 30000,
  ) {}

  stop() {
    this.stopped = true;
    this.active?.abort(
      new Error("Telegram operation cancelled by session shutdown."),
    );
  }

  private async run<T>(
    operation: (
      bot: BotTransport,
      signal: AbortSignal,
      markSent: () => void,
    ) => Promise<T>,
    callerSignal?: AbortSignal,
  ) {
    callerSignal?.throwIfAborted();
    if (this.stopped) throw new Error("This game session has shut down.");
    if (this.busy)
      throw new Error(
        "A Telegram operation is already running. Use one bears tool at a time.",
      );
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
    try {
      // Factory only reads local configuration; no network before connect.
      bot = await this.createTransport();
      controller.signal.throwIfAborted();
      const transport = bot;
      return await interrupted(
        (async () => {
          await transport.connect();
          controller.signal.throwIfAborted();
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
      if (sent) {
        throw new Error(
          `${rateLimit}Action may have reached the bot; outcome is unknown. Do not retry it. Read bears_history before deciding what to do next.`,
        );
      }
      if (rateLimit) throw new Error(rateLimit.trim());
      throw error;
    } finally {
      clearTimeout(timer);
      callerSignal?.removeEventListener("abort", abort);
      if (bot) {
        // Do not let socket teardown hold the pi tool indefinitely.
        await Promise.race([bot.close().catch(() => undefined), sleep(1000)]);
      }
      this.active = undefined;
      this.busy = false;
    }
  }

  history(limit = 10, beforeId?: number, signal?: AbortSignal) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 30)
      throw new Error("limit must be 1–30.");
    if (beforeId !== undefined && (!Number.isInteger(beforeId) || beforeId < 1))
      throw new Error("beforeId must be positive.");
    return this.run((bot) => bot.history(limit, beforeId), signal);
  }

  act(action: { text: string } | ButtonSelection, signal?: AbortSignal) {
    if (
      "text" in action &&
      (!action.text.trim() || action.text.length > 4096)
    ) {
      throw new Error("Send 1–4096 characters of plain text.");
    }
    return this.run(async (bot, operationSignal, markSent) => {
      const before = await bot.history(10);
      operationSignal.throwIfAborted();
      if (!("text" in action)) {
        selectedButton(await bot.message(action.messageId), action);
        operationSignal.throwIfAborted();
      }
      markSent();
      const acknowledgement =
        "text" in action
          ? await bot.send(action.text, operationSignal)
          : await bot.click(action, operationSignal);
      await sleep(this.replyWaitMs, undefined, { signal: operationSignal });
      operationSignal.throwIfAborted();
      const messages = await bot.history(10);
      const changes = messages.filter(
        (message) =>
          !message.outgoing &&
          !before.some(
            (old) => old.id === message.id && old.revision === message.revision,
          ),
      );
      return {
        delivery: "submitted",
        observation: changes.length ? "bot_updates_observed" : "no_update_yet",
        acknowledgement,
        messages: changes,
        note: "Updates may be unrelated or incomplete. This does not prove action success. Use bears_history for late replies; never blindly resend.",
      };
    }, signal);
  }
}
