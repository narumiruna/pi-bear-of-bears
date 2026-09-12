import type { Room } from "./world.js";

const MAX_MOVES_PER_CHARACTER = 40;
const DIRECTIONS = new Set(["北", "南", "東", "西"]);

const LEVEL_TARGETS: ReadonlyArray<{
  minimumLevel: number;
  rooms: readonly string[];
}> = [
  { minimumLevel: 155, rooms: ["霜風平原", "凍原小徑", "無光谷"] },
  { minimumLevel: 120, rooms: ["凍原小徑", "星圖廢墟", "無光谷"] },
  { minimumLevel: 90, rooms: ["星圖廢墟", "無光谷"] },
  { minimumLevel: 70, rooms: ["無光谷", "虛空邊界"] },
  { minimumLevel: 40, rooms: ["虛空邊界", "龍巢外圍", "蛙聲澤"] },
  { minimumLevel: 30, rooms: ["龍巢外圍", "蛙聲澤"] },
  { minimumLevel: 24, rooms: ["斷戟原", "蛙聲澤"] },
  { minimumLevel: 19, rooms: ["蛙聲澤", "螢石廊"] },
  { minimumLevel: 15, rooms: ["螢石廊", "鮭魚溪"] },
  { minimumLevel: 8, rooms: ["鮭魚溪", "蘑菇迷林"] },
  { minimumLevel: 1, rooms: ["蘑菇迷林"] },
];

interface RouteChoice {
  target: Room;
  path: Array<{ direction: string; room: Room }>;
  fallback: boolean;
}

export function cleanRoomName(value: string) {
  return value
    .replace(/^[^\p{Script=Han}A-Za-z0-9]+/u, "")
    .replace(/\s+🐾$/u, "")
    .trim();
}

function roomByName(rooms: readonly Room[], name: string) {
  const cleaned = cleanRoomName(name);
  return rooms.find((room) => cleanRoomName(room.name) === cleaned);
}

function findPath(
  rooms: readonly Room[],
  start: Room,
  target: Room,
): Array<{ direction: string; room: Room }> | undefined {
  if (start.id === target.id) {
    return [];
  }
  const byId = new Map(rooms.map((room) => [room.id, room]));
  const queue: Array<{
    room: Room;
    path: Array<{ direction: string; room: Room }>;
  }> = [{ room: start, path: [] }];
  const visited = new Set([start.id]);
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      break;
    }
    for (const [direction, targetId] of Object.entries(current.room.exits)) {
      const next = byId.get(targetId);
      if (
        !next ||
        next.boss ||
        visited.has(next.id) ||
        !DIRECTIONS.has(direction)
      ) {
        continue;
      }
      const path = [...current.path, { direction, room: next }];
      if (next.id === target.id) {
        return path;
      }
      visited.add(next.id);
      queue.push({ room: next, path });
    }
  }
  return undefined;
}

export function chooseIdleRoute(
  rooms: readonly Room[],
  level: number,
  location: string,
): RouteChoice {
  const start = roomByName(rooms, location);
  if (!start) {
    throw new Error(`公開地圖找不到目前位置「${location}」。`);
  }
  const policyIndex = LEVEL_TARGETS.findIndex(
    (entry) => level >= entry.minimumLevel,
  );
  const policy = LEVEL_TARGETS[policyIndex];
  if (!policy) {
    throw new Error(`不支援角色等級 Lv${level}。`);
  }
  const attempted = new Set<string>();
  for (const targetName of LEVEL_TARGETS.slice(policyIndex).flatMap(
    (entry) => entry.rooms,
  )) {
    if (attempted.has(targetName)) {
      continue;
    }
    attempted.add(targetName);
    const target = roomByName(rooms, targetName);
    // 公開快照缺少 monsterCount 代表未知，不等於沒有怪物。等級表內的
    // 固定狩獵區可接受未知值；只有明確為 0、安全區或 BOSS 房才排除。
    if (!target || target.safe || target.boss || target.monsterCount === 0) {
      continue;
    }
    const path = findPath(rooms, start, target);
    if (path && path.length <= MAX_MOVES_PER_CHARACTER) {
      return { target, path, fallback: targetName !== policy.rooms[0] };
    }
  }
  // 高等狩獵區遭 BOSS 隔斷時，仍可留在目前可掛機的非 BOSS 房，
  // 避免只因偏好路線不可達就讓整批角色全部失敗。
  if (!(start.safe || start.boss) && start.monsterCount !== 0) {
    return { target: start, path: [], fallback: true };
  }
  throw new Error(
    `找不到從「${start.name}」前往 Lv${level} 掛機區的非 BOSS 路線。`,
  );
}
