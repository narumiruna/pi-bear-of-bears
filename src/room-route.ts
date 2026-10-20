import { DIRECTIONS } from "./workflow-parsers.js";
import type { Room } from "./world.js";

/** 不改寫原始 BOSS 標記；未知裂隙非安全房也保守排除。 */
export function navigationBlocked(room: Room) {
  return room.boss || (room.sourceLayer === "rooms_rift" && !room.safe);
}

/** 只按已列出口搜尋；公開路線不是角色資格或即時安全證明。 */
export function findRoomPath(
  rooms: readonly Room[],
  start: Room,
  target: Room,
  directions: readonly string[] = DIRECTIONS,
) {
  if (navigationBlocked(target)) {
    return;
  }
  const byId = new Map(rooms.map((room) => [room.id, room]));
  const queue: { room: Room; path: { direction: string; room: Room }[] }[] = [
    { room: start, path: [] },
  ];
  const visited = new Set([start.id]);
  for (let index = 0; index < queue.length; index++) {
    const current = queue[index];
    if (current.room.id === target.id) {
      return current.path;
    }
    for (const [direction, id] of Object.entries(current.room.exits)) {
      const next = byId.get(id);
      if (
        !next ||
        navigationBlocked(next) ||
        visited.has(id) ||
        !directions.includes(direction)
      ) {
        continue;
      }
      visited.add(id);
      queue.push({
        room: next,
        path: [...current.path, { direction, room: next }],
      });
    }
  }
}
