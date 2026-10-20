import { afterEach, expect, test, vi } from "vitest";
import { chooseIdleRoute } from "../src/idle-route.js";
import { findRoomPath } from "../src/room-route.js";
import { parseWorld, type Room } from "../src/world.js";
import { NOW, roomText, workflowHarness } from "./fixtures/workflow.js";
import snapshot from "./fixtures/world-rift-public-20261020.json" with {
  type: "json",
};

afterEach(() => vi.restoreAllMocks());
const riftRooms = () => parseWorld(snapshot).rooms;
function riftRoom(rooms: Room[], id: number) {
  const room = rooms.find((room) => room.id === id);
  if (!room) {
    throw new Error(`測試缺少裂隙房 ${id}`);
  }
  return room;
}
const ordinary = (id: number, exits: Record<string, number> = {}): Room => ({
  id,
  name: `普通房${id}`,
  description: "",
  safe: false,
  boss: false,
  exits,
});

test.each([211, 212, 213, 214, 215, 216])(
  "move_to 排除原始 boss=0 的裂隙房 %i，不送移動或其他變更指令",
  async (destination) => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    const app = workflowHarness();
    app.state.location = "星核裂隙";
    const point = app.seed();
    app.overrides.set("/look", () => roomText("星核裂隙", "南"));
    app.world.allRooms = vi.fn(async () => riftRooms());
    const result = await app.call("bears_move_to", {
      scope: app.scope(point.id),
      destination,
    });
    expect(result.state).toBe("stopped");
    expect(
      app.sent.every((command) => command === "/status" || command === "/look"),
    ).toBe(true);
    expect(app.sent.some((command) => command.startsWith("/go "))).toBe(false);
  },
);

test("move_to 同房零步也不能接受裂隙非安全目的地", async () => {
  vi.spyOn(Date, "now").mockReturnValue(NOW);
  const app = workflowHarness();
  app.state.location = "裂隙·凍原獸影";
  const point = app.seed();
  app.overrides.set("/look", () => roomText(app.state.location, "北 南"));
  app.world.allRooms = vi.fn(async () => riftRooms());
  const result = await app.call("bears_move_to", {
    scope: app.scope(point.id),
    destination: 211,
  });
  expect(result.state).toBe("stopped");
  expect(
    app.sent.every((command) => command === "/status" || command === "/look"),
  ).toBe(true);
});

test("裂隙非安全房不可作中繼；安全210僅依既有ex通行，不補敘事出口", () => {
  const rooms = riftRooms();
  const safe = riftRoom(rooms, 210);
  const unsafe = riftRoom(rooms, 211);
  const start = ordinary(1, { 東: 210 });
  expect(
    findRoomPath([start, ...rooms], start, safe)?.map((step) => step.room.id),
  ).toEqual([210]);
  expect(findRoomPath([start, ...rooms], safe, start)).toBeUndefined();
  const end = ordinary(2);
  const bridge = {
    ...unsafe,
    name: "未知房",
    description: "",
    exits: { 東: 2 },
  };
  expect(findRoomPath([start, safe, bridge, end], start, end)).toBeUndefined();
  const oldUnder = { ...ordinary(300), sourceLayer: "rooms_under" as const };
  const oldSurface = {
    ...ordinary(3, { 下: 300 }),
    sourceLayer: "rooms" as const,
  };
  expect(
    findRoomPath([oldSurface, oldUnder], oldSurface, oldUnder)?.map(
      (step) => step.room.id,
    ),
  ).toEqual([300]);
});

test("Auto Idle 排除裂隙非安全候選與零步啟掛，不靠房名辨識", () => {
  const rooms = riftRooms();
  expect(() => chooseIdleRoute(rooms, 1, "星核裂隙")).toThrow("非 BOSS 路線");
  expect(() => chooseIdleRoute(rooms, 1, "裂隙·凍原獸影")).toThrow(
    "非 BOSS 路線",
  );
  const unsafe = {
    ...riftRoom(rooms, 211),
    name: "蘑菇迷林",
    description: "",
  };
  expect(() => chooseIdleRoute([unsafe], 1, unsafe.name)).toThrow(
    "非 BOSS 路線",
  );
  const safe = riftRoom(rooms, 210);
  const hunting = ordinary(2);
  expect(() =>
    chooseIdleRoute(
      [safe, { ...unsafe, exits: { 南: 2 } }, hunting],
      1,
      safe.name,
    ),
  ).toThrow("非 BOSS 路線");
  const start = ordinary(1, { 東: 210 });
  const safeBridge = { ...safe, exits: { 東: 2 } };
  expect(
    chooseIdleRoute(
      [{ ...start, safe: true }, safeBridge, hunting],
      1,
      start.name,
    ).path.map((step) => step.room.id),
  ).toEqual([210, 2]);
});
