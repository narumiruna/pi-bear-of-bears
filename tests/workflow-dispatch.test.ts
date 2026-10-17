import { expect, test, vi } from "vitest";
import { type BotTransport, Game } from "../src/game.js";
import { withDispatchCheck, withGameOperation } from "../src/game-operation.js";
import { message, roomText } from "./fixtures/workflow.js";

test("Game 在實際 send 前核對最新 ID／revision，不只依賴較早的 history", async () => {
  const before = message(1, roomText());
  const edited = { ...before, revision: "b".repeat(64) };
  const send = vi.fn(async () => {});
  const bot: BotTransport = {
    connect: async () => {},
    close: async () => {},
    history: async () => [edited],
    message: async () => undefined,
    send,
    click: async () => undefined,
  };
  const game = new Game(async () => bot, 0);
  const guard = vi.fn((messages: ReturnType<typeof message>[]) => {
    if (
      !messages.some(
        (current) =>
          current.id === before.id && current.revision === before.revision,
      )
    ) {
      throw new Error("來源已修訂");
    }
  });
  await expect(
    withGameOperation(() =>
      withDispatchCheck(guard, () => game.act({ text: "/rest" })),
    ),
  ).rejects.toThrow("not dispatched");
  expect(send).not.toHaveBeenCalled();
  expect(guard).toHaveBeenCalledOnce();
  await game.act({ text: "/status" });
  expect(send).toHaveBeenCalledTimes(1);
  expect(guard).toHaveBeenCalledOnce();
});

test("共用 Game 鎖拒絕其他 instance；dispatch guard 可拒絕被改寫的指令", async () => {
  const send = vi.fn(async () => {});
  const bot: BotTransport = {
    connect: async () => {},
    close: async () => {},
    history: async () => [],
    message: async () => undefined,
    send,
    click: async () => undefined,
  };
  const game = new Game(async () => bot, 0);
  await expect(
    withDispatchCheck(
      (_window, action) => {
        if (!("text" in action) || action.text !== "/deposit 900") {
          throw new Error("指令被改寫");
        }
      },
      () => game.act({ text: "/deposit 901" }),
    ),
  ).rejects.toThrow("not dispatched");
  expect(send).not.toHaveBeenCalled();
});
