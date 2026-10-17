import { expect, test, vi } from "vitest";
import { beginAutoIdle } from "../src/auto-idle-state.js";
import { type BotTransport, Game } from "../src/game.js";
import { withGameOperation } from "../src/game-operation.js";

function deferred() {
  let release: () => void = () => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
function transport(): BotTransport {
  return {
    connect: async () => {},
    close: async () => {},
    history: async () => [],
    message: async () => undefined,
    send: async () => {},
    click: async () => undefined,
  };
}

test("程序內流程鎖跨 Game instance；同 async 流程子動作可重入，外部工具不可插入", async () => {
  const gate = deferred(),
    started = deferred();
  const one = new Game(async () => transport(), 0),
    factory = vi.fn(async () => transport()),
    two = new Game(factory, 0);
  const active = withGameOperation(async () => {
    await one.history();
    started.release();
    await gate.promise;
    await one.act({ text: "/status" });
  });
  await started.promise;
  await expect(two.history()).rejects.toThrow("already running");
  expect(factory).not.toHaveBeenCalled();
  expect(() => beginAutoIdle()).toThrow("already running");
  gate.release();
  await active;
  await expect(two.history()).resolves.toEqual([]);
});

test("錯誤釋放 owner，不讓失敗流程永久阻擋下一個流程", async () => {
  await expect(
    withGameOperation(() => Promise.reject(new Error("test failure"))),
  ).rejects.toThrow("failure");
  await expect(withGameOperation(async () => 42)).resolves.toBe(42);
});

test("session stop 取消 in-flight Game，釋放流程鎖但不重送可能已送出的動作", async () => {
  const started = deferred(),
    gate = deferred();
  let reads = 0;
  const bot = transport();
  bot.send = vi.fn(async () => {
    started.release();
    await gate.promise;
  });
  bot.history = () => {
    reads++;
    return Promise.resolve([]);
  };
  const game = new Game(async () => bot, 0);
  const action = withGameOperation(() => game.act({ text: "/rest" }));
  await started.promise;
  game.stop();
  await expect(action).rejects.toThrow("outcome is unknown");
  expect(bot.send).toHaveBeenCalledTimes(1);
  gate.release();
  await expect(withGameOperation(async () => "released")).resolves.toBe(
    "released",
  );
  expect(reads).toBe(1);
});
