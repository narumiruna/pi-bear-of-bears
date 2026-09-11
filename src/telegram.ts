import { createHash } from "node:crypto";
import { Api, TelegramClient } from "teleproto";
import { EditedMessage } from "teleproto/events/EditedMessage.js";
import {
  NewMessage,
  type NewMessageEvent,
} from "teleproto/events/NewMessage.js";
import { Raw } from "teleproto/events/Raw.js";
import { Logger, LogLevel } from "teleproto/extensions/Logger.js";
import { UpdateConnectionState } from "teleproto/network/UpdateConnectionState.js";
import { StringSession } from "teleproto/sessions/index.js";
import { readSession, savedCredentials, sessionPath } from "./config.js";
import type { BotTransport, ButtonSelection, GameMessage } from "./game.js";
import { selectedButton } from "./game.js";
import type { WatchConnection } from "./watch.js";

export const BOT_USERNAME = "BearOfBearsBot";

export function createClient(
  session: string,
  apiId: number,
  apiHash: string,
  purpose: "game" | "login" | "watch" = "game",
) {
  return new TelegramClient(new StringSession(session), apiId, apiHash, {
    baseLogger: new Logger(LogLevel.NONE),
    // Login may need another attempt after Telegram migrates to the user's DC.
    // Gameplay retains one attempt to avoid replaying uncertain mutations.
    requestRetries: purpose === "login" ? 3 : 1,
    connectionRetries: purpose === "watch" ? 3 : 1,
    autoReconnect: purpose === "watch",
    floodSleepThreshold: 0,
    timeout: 10,
  });
}

export function snapshot(message: Api.Message): GameMessage {
  const markup = message.replyMarkup;
  const buttons =
    markup && "rows" in markup
      ? markup.rows.flatMap((row, rowIndex) =>
          row.buttons.map((button, column) => ({
            row: rowIndex,
            column,
            text: button.text,
            kind:
              button.type instanceof Api.InlineButtonTypeCallback &&
              !button.type.requiresPassword
                ? ("callback" as const)
                : button.type instanceof Api.ButtonTypeDefault
                  ? ("text" as const)
                  : ("unsupported" as const),
          })),
        )
      : [];
  return {
    id: message.id,
    outgoing: Boolean(message.out),
    text: message.message,
    date: message.date,
    revision: createHash("sha256")
      .update(
        JSON.stringify({
          text: message.message,
          editDate: message.editDate,
          markup: markup?.toJSON(),
        }),
      )
      .digest("hex"),
    buttons,
    hasMedia: Boolean(message.media),
  };
}

export class TelegramTransport implements BotTransport {
  private peer?: Api.TypeInputPeer;
  private closed = false;

  constructor(private readonly client: TelegramClient) {}

  async connect() {
    await this.client.connect();
    if (this.closed) {
      await this.client.destroy();
      throw new Error("Telegram connection was cancelled.");
    }
    if (!(await this.client.checkAuthorization())) {
      throw new Error(
        "Telegram session expired. Revoke/remove the old session and run npm run login.",
      );
    }
    const bot = await this.client.getEntity(BOT_USERNAME);
    if (
      !(bot instanceof Api.User && bot.bot) ||
      bot.username?.toLowerCase() !== BOT_USERNAME.toLowerCase()
    ) {
      throw new Error("Expected @BearOfBearsBot; refusing another recipient.");
    }
    this.peer = await this.client.getInputEntity(bot);
  }

  private recipient() {
    if (this.closed || !this.peer) {
      throw new Error("Telegram is not connected.");
    }
    return this.peer;
  }

  async history(limit: number, beforeId?: number) {
    const messages = await this.client.getMessages(this.recipient(), {
      limit,
      offsetId: beforeId,
    });
    return messages
      .filter(
        (message): message is Api.Message => message instanceof Api.Message,
      )
      .map(snapshot)
      .sort((a, b) => a.id - b.id);
  }

  private async rawMessage(id: number) {
    const messages = await this.client.getMessages(this.recipient(), {
      ids: [id],
    });
    const message = messages[0];
    // Telegram private-message IDs are account-wide, so verify peer ownership too.
    const peer = this.recipient();
    if (
      !(
        message instanceof Api.Message &&
        message.peerId instanceof Api.PeerUser &&
        peer instanceof Api.InputPeerUser &&
        message.peerId.userId.equals(peer.userId)
      )
    ) {
      return;
    }
    return message;
  }

  async message(id: number) {
    const message = await this.rawMessage(id);
    return message ? snapshot(message) : undefined;
  }

  async send(text: string, signal: AbortSignal) {
    signal.throwIfAborted();
    await this.client.sendMessage(this.recipient(), {
      message: text,
      parseMode: false,
      linkPreview: false,
    });
  }

  async click(selection: ButtonSelection, signal: AbortSignal) {
    signal.throwIfAborted();
    const message = await this.rawMessage(selection.messageId);
    signal.throwIfAborted();
    const button = selectedButton(
      message ? snapshot(message) : undefined,
      selection,
    );
    if (!message) {
      throw new Error("Message missing.");
    }
    if (button.kind === "text") {
      await this.send(button.text, signal);
      return;
    }
    const markup = message.replyMarkup;
    const raw =
      markup && "rows" in markup
        ? markup.rows[selection.row]?.buttons[selection.column]
        : undefined;
    if (
      !(raw?.type instanceof Api.InlineButtonTypeCallback) ||
      raw.type.requiresPassword
    ) {
      throw new Error("Unsupported button.");
    }
    const answer = await this.client.invoke(
      new Api.messages.GetBotCallbackAnswer({
        peer: this.recipient(),
        msgId: message.id,
        data: raw.type.data,
      }),
    );
    // Never open callback URLs or payment/auth flows.
    return answer.message;
  }

  subscribe(
    onMessage: (message: GameMessage) => void,
    onConnection: (connected: boolean) => void,
  ) {
    const peer = this.recipient();
    const events = [
      new NewMessage({ chats: [peer] }),
      new EditedMessage({ chats: [peer] }),
    ];
    const handler = (event: NewMessageEvent) => {
      const message = event.message;
      // Defense in depth: never forward another chat even if a builder misfilters.
      if (
        !this.closed &&
        message instanceof Api.Message &&
        message.peerId instanceof Api.PeerUser &&
        peer instanceof Api.InputPeerUser &&
        message.peerId.userId.equals(peer.userId)
      ) {
        onMessage(snapshot(message));
      }
    };
    const stateEvent = new Raw({ types: [UpdateConnectionState] });
    const stateHandler = (update: unknown) => {
      if (!this.closed && update instanceof UpdateConnectionState) {
        onConnection(update.state === UpdateConnectionState.connected);
      }
    };
    for (const event of events) {
      this.client.addEventHandler(handler, event);
    }
    this.client.addEventHandler(stateHandler, stateEvent);
    return () => {
      for (const event of events) {
        this.client.removeEventHandler(handler, event);
      }
      this.client.removeEventHandler(stateHandler, stateEvent);
    };
  }

  async close() {
    this.closed = true;
    await this.client.destroy();
  }
}

export async function createWatchConnection(): Promise<WatchConnection> {
  const { apiId, apiHash } = await savedCredentials();
  const session = await readSession(sessionPath());
  return new TelegramTransport(createClient(session, apiId, apiHash, "watch"));
}

export async function createTransport(): Promise<BotTransport> {
  const { apiId, apiHash } = await savedCredentials();
  const session = await readSession(sessionPath());
  return new TelegramTransport(createClient(session, apiId, apiHash));
}
