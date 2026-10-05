import { afterEach, expect, test, vi } from "vitest";
import {
  type BotTransport,
  Game,
  type GameMessage,
  selectedButton,
} from "../src/game.js";

const message: GameMessage = {
  id: 10,
  outgoing: false,
  text: "menu",
  date: 1,
  revision: "a".repeat(64),
  buttons: [{ row: 0, column: 0, text: "Look", kind: "callback" }],
  hasMedia: false,
};
const selection = {
  messageId: 10,
  revision: message.revision,
  row: 0,
  column: 0,
};

function setup() {
  const bot = {
    connect: vi.fn(async () => {}),
    history: vi.fn<BotTransport["history"]>().mockResolvedValue([message]),
    message: vi.fn<BotTransport["message"]>().mockResolvedValue(message),
    send: vi.fn<BotTransport["send"]>().mockResolvedValue(undefined),
    click: vi.fn<BotTransport["click"]>().mockResolvedValue("OK"),
    close: vi.fn(async () => {}),
  };
  const factory = vi.fn(async () => bot);
  return { bot, factory, game: new Game(factory, 1, 100) };
}

afterEach(() => vi.restoreAllMocks());

test("history is read-only and closes the connection", async () => {
  const { game, bot } = setup();
  expect(await game.history(5, 20)).toEqual([message]);
  expect(bot.history).toHaveBeenCalledWith(5, 20);
  expect(bot.send).not.toHaveBeenCalled();
  expect(bot.close).toHaveBeenCalledOnce();
});

test("send submits once and detects edited messages", async () => {
  const { game, bot } = setup();
  const edited = { ...message, revision: "b".repeat(64), text: "new state" };
  bot.history.mockResolvedValueOnce([message]).mockResolvedValueOnce([edited]);
  const result = await game.act({ text: "/help" });
  expect(result.messages).toEqual([edited]);
  expect(result.observation).toBe("bot_updates_observed");
  expect(bot.send).toHaveBeenCalledOnce();
});

test("outgoing messages do not count as bot replies", async () => {
  const { game, bot } = setup();
  bot.history
    .mockResolvedValueOnce([message])
    .mockResolvedValueOnce([message, { ...message, id: 11, outgoing: true }]);
  expect((await game.act({ text: "look" })).observation).toBe("no_update_yet");
});

test("click validates a fresh revision and returns callback acknowledgement", async () => {
  const { game, bot } = setup();
  expect((await game.act(selection)).acknowledgement).toBe("OK");
  expect(bot.click).toHaveBeenCalledOnce();
  bot.message.mockResolvedValue({ ...message, revision: "changed" });
  await expect(game.act(selection)).rejects.toThrow("changed");
  expect(bot.click).toHaveBeenCalledOnce();
});

test("unsupported, missing and outgoing buttons are rejected", () => {
  expect(() => selectedButton(undefined, selection)).toThrow();
  expect(() =>
    selectedButton({ ...message, outgoing: true }, selection),
  ).toThrow();
  expect(() => selectedButton(message, { ...selection, column: 1 })).toThrow();
  expect(() =>
    selectedButton(
      { ...message, buttons: [{ ...message.buttons[0], kind: "unsupported" }] },
      selection,
    ),
  ).toThrow("blocked");
});

test("failed mutation is not retried and reports uncertainty", async () => {
  const { game, bot } = setup();
  bot.send.mockRejectedValue(new Error("socket lost"));
  await expect(game.act({ text: "move" })).rejects.toThrow(
    "outcome is unknown",
  );
  expect(bot.send).toHaveBeenCalledOnce();
  expect(bot.close).toHaveBeenCalledOnce();
});

test("connect failure reports no dispatch without retrying", async () => {
  const { game, bot, factory } = setup();
  bot.connect.mockRejectedValue(new Error("connection lost"));
  await expect(game.act({ text: "/skill 熊力衝擊" })).rejects.toThrow(
    "Action was not dispatched to the bot. connection lost",
  );
  expect(factory).toHaveBeenCalledOnce();
  expect(bot.send).not.toHaveBeenCalled();
  expect(bot.click).not.toHaveBeenCalled();
  expect(bot.close).toHaveBeenCalledOnce();
});

test("preflight history failure reports no dispatch", async () => {
  const { game, bot } = setup();
  bot.history.mockRejectedValue(new Error("history failed"));
  await expect(game.act(selection)).rejects.toThrow(
    "Action was not dispatched to the bot. history failed",
  );
  expect(bot.send).not.toHaveBeenCalled();
  expect(bot.click).not.toHaveBeenCalled();
});

test("late connect after pre-dispatch timeout cannot send", async () => {
  const { factory, bot } = setup();
  const game = new Game(factory, 1, 10);
  let release!: () => void;
  bot.connect.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  await expect(game.act({ text: "move" })).rejects.toThrow(
    "Action was not dispatched to the bot. Telegram operation timed out.",
  );
  release();
  await Promise.resolve();
  expect(bot.send).not.toHaveBeenCalled();
  expect(bot.close).toHaveBeenCalledOnce();
});

test("post-dispatch observation failure remains uncertain", async () => {
  const { game, bot } = setup();
  bot.history
    .mockResolvedValueOnce([message])
    .mockRejectedValueOnce(new Error("history failed"));
  await expect(game.act({ text: "move" })).rejects.toThrow(
    "outcome is unknown",
  );
  expect(bot.send).toHaveBeenCalledOnce();
});

test("read-only connection errors do not claim action delivery", async () => {
  const { game, bot } = setup();
  bot.connect.mockRejectedValue(new Error("connection lost"));
  await expect(game.history()).rejects.toThrow(/^connection lost$/);
});

test("pre-dispatch flood limits preserve the mandatory wait", async () => {
  const { game, bot } = setup();
  bot.history.mockRejectedValue(
    Object.assign(new Error("flood"), { seconds: 60 }),
  );
  await expect(game.act({ text: "move" })).rejects.toThrow(
    "Telegram rate limit: wait 60 seconds before any further requests. Action was not dispatched",
  );
  expect(bot.send).not.toHaveBeenCalled();
});

test("pre-aborted operations never create a client", async () => {
  const { game, factory } = setup();
  await expect(
    game.history(10, undefined, AbortSignal.abort()),
  ).rejects.toThrow();
  expect(factory).not.toHaveBeenCalled();
});

test("parallel actions are rejected; cancellation before send prevents mutations", async () => {
  const { game, bot } = setup();
  let release!: () => void;
  bot.connect.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  const controller = new AbortController();
  const running = game.act({ text: "move" }, controller.signal);
  const rejection = expect(running).rejects.toThrow("cancelled");
  await vi.waitFor(() => expect(bot.connect).toHaveBeenCalled());
  await expect(game.act({ text: "second" })).rejects.toThrow("already running");
  controller.abort();
  await rejection;
  release();
  await Promise.resolve();
  expect(bot.send).not.toHaveBeenCalled();
});

test("timeout after submission is uncertain and closes the client", async () => {
  const { factory, bot } = setup();
  const game = new Game(factory, 1, 10);
  bot.send.mockImplementation(() => new Promise(() => {}));
  await expect(game.act({ text: "move" })).rejects.toThrow(
    "outcome is unknown",
  );
  expect(bot.close).toHaveBeenCalledOnce();
});

test("shutdown cancels active operations and prevents future calls", async () => {
  const { game, bot } = setup();
  bot.history.mockImplementation(() => new Promise(() => {}));
  const operation = game.history();
  const rejection = expect(operation).rejects.toThrow("shutdown");
  await vi.waitFor(() => expect(bot.history).toHaveBeenCalled());
  game.stop();
  await rejection;
  await expect(game.history()).rejects.toThrow("shut down");
});

test("invalid input is rejected before creating a client", () => {
  const { game, factory } = setup();
  expect(() => game.act({ text: "  " })).toThrow();
  expect(() => game.history(31)).toThrow();
  expect(() => game.history(1, -1)).toThrow();
  expect(factory).not.toHaveBeenCalled();
});
