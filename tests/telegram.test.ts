import { Api, type TelegramClient } from "teleproto";
import { returnBigInt } from "teleproto/Helpers.js";
import { UpdateConnectionState } from "teleproto/network/UpdateConnectionState.js";
import { expect, test, vi } from "vitest";
import { snapshot, TelegramTransport } from "../src/telegram.js";

function message(
  type: Api.TypeInlineButtonType = new Api.InlineButtonTypeCallback({
    data: Buffer.from("look"),
  }),
) {
  return new Api.Message({
    id: 10,
    peerId: new Api.PeerUser({ userId: returnBigInt(42) }),
    date: 1,
    message: "menu",
    replyMarkup: new Api.ReplyInlineMarkup({
      rows: [
        new Api.KeyboardInlineButtonRow({
          buttons: [new Api.KeyboardInlineButton({ text: "Look", type })],
        }),
      ],
    }),
  });
}

function setup() {
  const raw = message();
  const client = {
    connect: vi.fn(async () => true),
    checkAuthorization: vi.fn(async () => true),
    getEntity: vi.fn(
      async () =>
        new Api.User({
          id: returnBigInt(42),
          bot: true,
          username: "BearOfBearsBot",
        }),
    ),
    getInputEntity: vi.fn(
      async () =>
        new Api.InputPeerUser({
          userId: returnBigInt(42),
          accessHash: returnBigInt(1),
        }),
    ),
    getMessages: vi.fn(async () => [raw]),
    sendMessage: vi.fn(async () => raw),
    invoke: vi.fn(async () => ({
      message: "done",
      url: "https://example.com",
    })),
    destroy: vi.fn(async () => {}),
    addEventHandler:
      vi.fn<(callback: (event: unknown) => void, event: unknown) => void>(),
    removeEventHandler: vi.fn(),
  };
  const transport = new TelegramTransport(client as unknown as TelegramClient);
  const selection = {
    messageId: 10,
    revision: snapshot(raw).revision,
    row: 0,
    column: 0,
  };
  return { client, transport, raw, selection };
}

test("watch forwards only game-chat messages and edits, reports state, and removes handlers", async () => {
  const { transport, client, raw } = setup();
  await transport.connect();
  const receive = vi.fn();
  const state = vi.fn();
  const unsubscribe = transport.subscribe(receive, state);
  expect(client.addEventHandler).toHaveBeenCalledTimes(3);
  const onNew = client.addEventHandler.mock.calls[0][0];
  const onEdit = client.addEventHandler.mock.calls[1][0];
  const onState = client.addEventHandler.mock.calls[2][0];
  onNew({ message: raw });
  raw.out = true;
  onNew({ message: raw });
  raw.message = "edited";
  onEdit({ message: raw });
  expect(receive).toHaveBeenCalledTimes(3);
  raw.peerId = new Api.PeerUser({ userId: returnBigInt(99) });
  onNew({ message: raw });
  expect(receive).toHaveBeenCalledTimes(3);
  onState(new UpdateConnectionState(UpdateConnectionState.broken));
  expect(state).toHaveBeenLastCalledWith(false);
  unsubscribe();
  expect(client.removeEventHandler).toHaveBeenCalledTimes(3);
  await transport.close();
  onState(new UpdateConnectionState(UpdateConnectionState.connected));
  expect(state).toHaveBeenCalledOnce();
});

test("snapshot exposes button coordinates but never callback payloads", () => {
  const view = snapshot(message());
  expect(view.buttons).toEqual([
    { row: 0, column: 0, text: "Look", kind: "callback" },
  ]);
  expect(view.revision).toMatch(/^[a-f0-9]{64}$/);
  expect(JSON.stringify(view)).not.toContain('"data"');
  expect(
    snapshot(
      message(
        new Api.InlineButtonTypeCallback({ data: Buffer.from("different") }),
      ),
    ).revision,
  ).not.toBe(view.revision);
});

test("URL, payment, password, phone and location buttons are unsupported", () => {
  for (const type of [
    new Api.InlineButtonTypeUrl({ url: "https://example.com" }),
    new Api.InlineButtonTypeBuy(),
    new Api.InlineButtonTypeCallback({
      data: Buffer.from("x"),
      requiresPassword: true,
    }),
  ]) {
    expect(snapshot(message(type)).buttons[0].kind).toBe("unsupported");
  }
  for (const type of [
    new Api.ButtonTypeRequestPhone(),
    new Api.ButtonTypeRequestGeoLocation(),
    new Api.ButtonTypeDefault(),
  ]) {
    const raw = message();
    raw.replyMarkup = new Api.ReplyKeyboardMarkup({
      rows: [
        new Api.KeyboardButtonRow({
          buttons: [new Api.KeyboardButton({ text: "button", type })],
        }),
      ],
    });
    expect(snapshot(raw).buttons[0].kind).toBe(
      type instanceof Api.ButtonTypeDefault ? "text" : "unsupported",
    );
  }
});

test("only resolves the game bot and sends unformatted text", async () => {
  const { client, transport } = setup();
  await transport.connect();
  await transport.send("**look**", new AbortController().signal);
  expect(client.getEntity).toHaveBeenCalledWith("BearOfBearsBot");
  expect(client.sendMessage.mock.calls[0]).toEqual([
    expect.any(Api.InputPeerUser),
    { message: "**look**", parseMode: false, linkPreview: false },
  ]);
});

test("refuses non-bot recipients and unauthorized sessions", async () => {
  const { client, transport } = setup();
  client.getEntity.mockResolvedValue(
    new Api.User({
      id: returnBigInt(42),
      bot: false,
      username: "BearOfBearsBot",
    }),
  );
  await expect(transport.connect()).rejects.toThrow("refusing");
  client.checkAuthorization.mockResolvedValue(false);
  await expect(transport.connect()).rejects.toThrow("expired");
});

test("rejects message IDs from other private chats", async () => {
  const { transport, raw } = setup();
  await transport.connect();
  raw.peerId = new Api.PeerUser({ userId: returnBigInt(99) });
  expect(await transport.message(10)).toBeUndefined();
});

test("click uses server-provided callback data and ignores callback URLs", async () => {
  const { client, transport, selection } = setup();
  await transport.connect();
  expect(await transport.click(selection, new AbortController().signal)).toBe(
    "done",
  );
  expect(client.invoke).toHaveBeenCalledWith(
    expect.objectContaining({
      className: "messages.GetBotCallbackAnswer",
      msgId: 10,
      data: Buffer.from("look"),
    }),
  );
});

test("cancellation during button refresh prevents callback submission", async () => {
  const { client, transport, selection, raw } = setup();
  const controller = new AbortController();
  await transport.connect();
  client.getMessages.mockImplementation(() => {
    controller.abort();
    return Promise.resolve([raw]);
  });
  await expect(transport.click(selection, controller.signal)).rejects.toThrow();
  expect(client.invoke).not.toHaveBeenCalled();
});
