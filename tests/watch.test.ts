import { afterEach, expect, test, vi } from "vitest";
import type { GameMessage } from "../src/game.js";
import { GameWatch, type WatchConnection } from "../src/watch.js";

const message: GameMessage = {
  id: 1,
  outgoing: false,
  text: "status",
  date: 1,
  revision: "a",
  buttons: [],
  hasMedia: false,
};
const watches: GameWatch[] = [];

function setup() {
  let receive: (message: GameMessage) => void = () => {};
  let connectionState: (connected: boolean) => void = () => {};
  const unsubscribe = vi.fn();
  const connection = {
    connect: vi.fn(async () => {}),
    subscribe: vi.fn<WatchConnection["subscribe"]>(
      (onMessage, onConnection) => {
        receive = onMessage;
        connectionState = onConnection;
        return unsubscribe;
      },
    ),
    close: vi.fn(async () => {}),
  };
  const create = vi.fn(async () => connection);
  const batches = vi.fn(async (_batch: unknown, _signal: AbortSignal) => {});
  const status = vi.fn();
  const watch = new GameWatch(create, batches, status, 5, 100);
  watches.push(watch);
  return {
    watch,
    connection,
    create,
    batches,
    status,
    unsubscribe,
    receive: (value: GameMessage) => receive(value),
    state: (value: boolean) => connectionState(value),
  };
}

afterEach(async () => {
  await Promise.all(watches.splice(0).map((watch) => watch.stop()));
});

test("construction is inert and start is idempotent", async () => {
  const { watch, create, connection } = setup();
  expect(create).not.toHaveBeenCalled();
  await Promise.all([watch.start(), watch.start()]);
  expect(create).toHaveBeenCalledOnce();
  expect(connection.subscribe).toHaveBeenCalledOnce();
  expect(watch.status).toBe("listening");
});

test("coalesces edits, deduplicates updates and includes outgoing manual commands", async () => {
  const { watch, receive, batches } = setup();
  await watch.start();
  receive(message);
  receive(message);
  receive({ ...message, revision: "b", text: "edited status" });
  receive({ ...message, id: 2, outgoing: true, text: "/status" });
  await vi.waitFor(() => expect(batches).toHaveBeenCalledOnce());
  expect(batches.mock.calls[0][0]).toEqual({
    messages: [
      { ...message, revision: "b", text: "edited status" },
      { ...message, id: 2, outgoing: true, text: "/status" },
    ],
    omitted: 0,
  });
});

test("bounds message bursts and reports omitted updates", async () => {
  const { watch, receive, batches } = setup();
  await watch.start();
  for (let id = 1; id <= 25; id++) receive({ ...message, id });
  await vi.waitFor(() => expect(batches).toHaveBeenCalledOnce());
  expect(batches.mock.calls[0][0]).toMatchObject({
    omitted: 5,
    messages: expect.arrayContaining([{ ...message, id: 25 }]),
  });
  expect(
    (batches.mock.calls[0][0] as { messages: unknown[] }).messages,
  ).toHaveLength(20);
});

test("shutdown clears pending updates, unsubscribes and ignores late events", async () => {
  const { watch, receive, state, batches, connection, unsubscribe } = setup();
  await watch.start();
  receive(message);
  await watch.stop();
  receive({ ...message, id: 2 });
  state(true);
  expect(unsubscribe).toHaveBeenCalledOnce();
  expect(connection.close).toHaveBeenCalledOnce();
  expect(batches).not.toHaveBeenCalled();
  expect(watch.status).toBe("off");
  await watch.stop();
  expect(unsubscribe).toHaveBeenCalledOnce();
});

test("connection errors are contained and explicit restart is possible", async () => {
  const { watch, connection, status } = setup();
  connection.connect.mockRejectedValueOnce(new Error("sensitive SDK payload"));
  await watch.start();
  expect(watch.status).toBe("error");
  expect(JSON.stringify(status.mock.calls)).not.toContain("sensitive");
  await watch.start();
  expect(watch.status).toBe("listening");
});

test("stopping during connection prevents subscription", async () => {
  const { watch, connection } = setup();
  let release!: () => void;
  connection.connect.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  const starting = watch.start();
  await vi.waitFor(() => expect(connection.connect).toHaveBeenCalled());
  await watch.stop();
  release();
  await starting;
  expect(connection.subscribe).not.toHaveBeenCalled();
  expect(watch.status).toBe("off");
});

test("reports disconnect and recovery without creating extra subscriptions", async () => {
  const { watch, state, connection } = setup();
  await watch.start();
  state(false);
  expect(watch.status).toBe("disconnected");
  state(true);
  expect(watch.status).toBe("listening");
  expect(connection.subscribe).toHaveBeenCalledOnce();
});

test("startup timeout closes the connection", async () => {
  const { connection, batches, status } = setup();
  const watch = new GameWatch(async () => connection, batches, status, 1, 5);
  watches.push(watch);
  connection.connect.mockImplementation(() => new Promise(() => {}));
  await watch.start();
  expect(watch.status).toBe("error");
  expect(connection.close).toHaveBeenCalledOnce();
});
