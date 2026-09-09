import type { Game, GameMessage } from "./game.js";
import { plainGameText } from "./game-text.js";
import type { Room, WorldMap } from "./world.js";

const MAX_CHARACTERS = 9;
const MAX_MOVES_PER_CHARACTER = 40;
const MAX_COMMANDS = 200;
const NAME_PATTERN = /^[\p{L}\p{N}_]{1,32}$/u;
const DIRECTIONS = new Set(["北", "南", "東", "西"]);

export interface AutoIdleCharacter {
  name: string;
  job: string;
  level: number;
  location: string;
  active: boolean;
  idle: boolean;
}

export interface AutoIdleCharacterResult {
  name: string;
  level: number;
  from: string;
  target: string;
  moves: number;
  result: "started" | "already_running" | "stopped";
  fallback: boolean;
}

export interface AutoIdleResult {
  action: "start" | "stop";
  commands: number;
  characters: AutoIdleCharacterResult[];
}

type GameActionResult = Awaited<ReturnType<Game["act"]>>;

type Progress = (message: string) => void;

interface RouteChoice {
  target: Room;
  path: Array<{ direction: string; room: Room }>;
  fallback: boolean;
}

interface SelectedCharacter {
  name: string;
  job: string;
  level: number;
  location: string;
  idleSettled: boolean;
}

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

function cleanRoomName(value: string) {
  return value
    .replace(/^[^\p{Script=Han}A-Za-z0-9]+/u, "")
    .replace(/\s+🐾$/u, "")
    .trim();
}

function safeCharacterName(name: string) {
  if (!NAME_PATTERN.test(name))
    throw new Error("角色清單含有不支援的名稱格式，未送出切換指令。");
  return name;
}

export function parseCharacterList(text: string): AutoIdleCharacter[] {
  const characters: AutoIdleCharacter[] = [];
  for (const sourceLine of plainGameText(text).split("\n")) {
    const line = sourceLine.trim();
    const match = line.match(
      /^(?<active>▶️\s*)?\S+\s+(?<name>[\p{L}\p{N}_]{1,32})\s+(?<job>\S+)\s+Lv(?<level>\d+)\s+❤(?<hp>\d+)\/(?<maxHp>\d+)\s+📍(?<location>.+?)(?<idle>\s+🐾)?$/u,
    );
    if (!match?.groups) continue;
    const level = Number(match.groups.level);
    if (!Number.isSafeInteger(level) || level < 1) continue;
    characters.push({
      name: safeCharacterName(match.groups.name),
      job: match.groups.job,
      level,
      location: cleanRoomName(match.groups.location),
      active: Boolean(match.groups.active),
      idle: Boolean(match.groups.idle),
    });
  }
  const names = new Set(characters.map((character) => character.name));
  if (
    characters.length < 1 ||
    characters.length > MAX_CHARACTERS ||
    names.size !== characters.length ||
    characters.filter((character) => character.active).length !== 1
  ) {
    throw new Error("無法從 /chars 唯一確認 1–9 個角色與目前角色。");
  }
  return characters;
}

export function parseSelectedCharacter(
  text: string,
  expectedName: string,
): SelectedCharacter | undefined {
  const escaped = expectedName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const selected = plainGameText(text).match(
    new RegExp(
      `已切換為\\s+\\S+\\s+(${escaped})（([^\\s（）]+)\\s+Lv(\\d+)）`,
      "u",
    ),
  );
  const location = plainGameText(text).match(/^📍\s*(.+?)\s+輸入 \/look/mu);
  if (!selected || !location) return undefined;
  const level = Number(selected[3]);
  if (!Number.isSafeInteger(level) || level < 1) return undefined;
  return {
    name: selected[1],
    job: selected[2],
    level,
    location: cleanRoomName(location[1]),
    idleSettled:
      text.includes(`${expectedName} 掛機結算`) && text.includes("掛機已結束"),
  };
}

export function parseCurrentStatus(
  text: string,
): AutoIdleCharacter | undefined {
  const plain = plainGameText(text);
  const title = plain.match(
    /^\S+\s+(?<name>[\p{L}\p{N}_]{1,32})\s+(?<job>\S+)\s+Lv(?<level>\d+)$/mu,
  );
  const location = plain.match(/^位置[：:]\s*(.+)$/mu);
  if (!title?.groups || !location) return undefined;
  const level = Number(title.groups.level);
  if (!Number.isSafeInteger(level) || level < 1) return undefined;
  return {
    name: safeCharacterName(title.groups.name),
    job: title.groups.job,
    level,
    location: cleanRoomName(location[1]),
    active: true,
    idle: /^🐾\s*掛機中/mu.test(plain),
  };
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
  if (start.id === target.id) return [];
  const byId = new Map(rooms.map((room) => [room.id, room]));
  const queue: Array<{
    room: Room;
    path: Array<{ direction: string; room: Room }>;
  }> = [{ room: start, path: [] }];
  const visited = new Set([start.id]);
  while (queue.length) {
    const current = queue.shift();
    if (!current) break;
    for (const [direction, targetId] of Object.entries(current.room.exits)) {
      const next = byId.get(targetId);
      if (
        !next ||
        next.boss ||
        visited.has(next.id) ||
        !DIRECTIONS.has(direction)
      )
        continue;
      const path = [...current.path, { direction, room: next }];
      if (next.id === target.id) return path;
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
  if (!start) throw new Error(`公開地圖找不到目前位置「${location}」。`);
  const policy = LEVEL_TARGETS.find((entry) => level >= entry.minimumLevel);
  if (!policy) throw new Error(`不支援角色等級 Lv${level}。`);
  for (const targetName of policy.rooms) {
    const target = roomByName(rooms, targetName);
    if (!target || target.safe || target.boss || !target.monsterCount) continue;
    const path = findPath(rooms, start, target);
    if (path && path.length <= MAX_MOVES_PER_CHARACTER)
      return { target, path, fallback: targetName !== policy.rooms[0] };
  }
  throw new Error(
    `找不到從「${start.name}」前往 Lv${level} 掛機區的非 BOSS 路線。`,
  );
}

function latestParsed<T>(
  messages: readonly GameMessage[],
  parser: (text: string) => T | undefined,
) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message.outgoing) {
      const parsed = parser(message.text);
      if (parsed !== undefined) return parsed;
    }
  }
  return undefined;
}

export class AutoIdle {
  private commands = 0;

  constructor(
    private readonly game: Pick<Game, "act" | "stop">,
    private readonly world: Pick<WorldMap, "allRooms">,
    private readonly observe: (messages: GameMessage[]) => void = () => {},
    private readonly progress: Progress = () => {},
  ) {}

  stop() {
    this.game.stop();
  }

  private async command<T>(
    text: string,
    parse: (messages: GameMessage[]) => T | undefined,
    signal?: AbortSignal,
  ) {
    if (this.commands >= MAX_COMMANDS)
      throw new Error(`Auto Idle 已達 ${MAX_COMMANDS} 個指令上限。`);
    this.commands += 1;
    const result: GameActionResult = await this.game.act({ text }, signal);
    this.observe(result.messages);
    const parsed = parse(result.messages);
    if (parsed === undefined) {
      throw new Error(
        `${text.split(" ")[0]} 回覆無法確認結果；已停止且不會重送。`,
      );
    }
    return parsed;
  }

  private listCharacters(signal?: AbortSignal) {
    return this.command(
      "/chars",
      (messages) =>
        latestParsed(messages, (text) => {
          try {
            return parseCharacterList(text);
          } catch {
            return undefined;
          }
        }),
      signal,
    );
  }

  private switchCharacter(
    character: AutoIdleCharacter,
    requireSettlement: boolean,
    signal?: AbortSignal,
  ) {
    safeCharacterName(character.name);
    return this.command(
      `/switch ${character.name}`,
      (messages) => {
        const selected = latestParsed(messages, (text) =>
          parseSelectedCharacter(text, character.name),
        );
        if (!selected || (requireSettlement && !selected.idleSettled))
          return undefined;
        return selected;
      },
      signal,
    );
  }

  private currentStatus(expectedName: string, signal?: AbortSignal) {
    return this.command(
      "/status",
      (messages) => {
        const status = latestParsed(messages, parseCurrentStatus);
        return status?.name === expectedName ? status : undefined;
      },
      signal,
    );
  }

  private move(direction: string, expectedRoom: Room, signal?: AbortSignal) {
    if (!DIRECTIONS.has(direction))
      throw new Error(`公開地圖含有不支援的方向「${direction}」。`);
    return this.command(
      `/go ${direction}`,
      (messages) =>
        latestParsed(messages, (text) => {
          const lines = plainGameText(text)
            .split("\n")
            .map((line) => cleanRoomName(line));
          return text.includes(`你往${direction}走去`) &&
            lines.includes(cleanRoomName(expectedRoom.name)) &&
            text.includes("🚪 出口")
            ? expectedRoom.name
            : undefined;
        }),
      signal,
    );
  }

  private startCurrent(expectedRoom: Room, signal?: AbortSignal) {
    return this.command(
      "/idle",
      (messages) =>
        latestParsed(messages, (text) =>
          text.startsWith("🐾 開始掛機！") &&
          cleanRoomName(text.split("\n")[0]).includes(
            cleanRoomName(expectedRoom.name),
          )
            ? true
            : undefined,
        ),
      signal,
    );
  }

  private stopCurrent(signal?: AbortSignal) {
    return this.command(
      "/stopidle",
      (messages) =>
        latestParsed(messages, (text) =>
          text.startsWith("🐾") && text.includes("掛機已結束")
            ? true
            : undefined,
        ),
      signal,
    );
  }

  async start(signal?: AbortSignal): Promise<AutoIdleResult> {
    this.commands = 0;
    const rooms = await this.world.allRooms(signal);
    const characters = await this.listCharacters(signal);
    const original = characters.find((character) => character.active);
    if (!original) throw new Error("/chars 未標示目前角色。");
    const ordered = [
      ...characters.filter((character) => !character.active),
      original,
    ];
    let currentName = original.name;
    const completed: AutoIdleCharacterResult[] = [];

    for (const listed of ordered) {
      signal?.throwIfAborted();
      this.progress(`正在處理 ${listed.name}…`);
      let character: AutoIdleCharacter;
      if (listed.name !== currentName) {
        const selected = await this.switchCharacter(
          listed,
          listed.idle,
          signal,
        );
        currentName = selected.name;
        character = {
          ...selected,
          active: true,
          idle: false,
        };
      } else {
        character = await this.currentStatus(listed.name, signal);
      }

      const route = chooseIdleRoute(rooms, character.level, character.location);
      if (character.idle && route.path.length === 0) {
        completed.push({
          name: character.name,
          level: character.level,
          from: character.location,
          target: route.target.name,
          moves: 0,
          result: "already_running",
          fallback: route.fallback,
        });
        continue;
      }
      for (const step of route.path) {
        await this.move(step.direction, step.room, signal);
      }
      await this.startCurrent(route.target, signal);
      completed.push({
        name: character.name,
        level: character.level,
        from: character.location,
        target: route.target.name,
        moves: route.path.length,
        result: "started",
        fallback: route.fallback,
      });
    }

    return { action: "start", commands: this.commands, characters: completed };
  }

  async stopAll(signal?: AbortSignal): Promise<AutoIdleResult> {
    this.commands = 0;
    const characters = await this.listCharacters(signal);
    const original = characters.find((character) => character.active);
    if (!original) throw new Error("/chars 未標示目前角色。");
    const idleCharacters = characters.filter((character) => character.idle);
    const ordered = [
      ...idleCharacters.filter((character) => !character.active),
      ...idleCharacters.filter((character) => character.active),
    ];
    let currentName = original.name;
    const completed: AutoIdleCharacterResult[] = [];

    for (const character of ordered) {
      signal?.throwIfAborted();
      this.progress(`正在停止 ${character.name}…`);
      if (character.name === currentName) {
        await this.stopCurrent(signal);
      } else {
        const selected = await this.switchCharacter(character, true, signal);
        currentName = selected.name;
      }
      completed.push({
        name: character.name,
        level: character.level,
        from: character.location,
        target: character.location,
        moves: 0,
        result: "stopped",
        fallback: false,
      });
    }

    if (currentName !== original.name) {
      await this.switchCharacter(original, false, signal);
    }
    return { action: "stop", commands: this.commands, characters: completed };
  }
}

export function formatAutoIdleResult(result: AutoIdleResult) {
  const action = result.action === "start" ? "掛機設定完成" : "掛機停止完成";
  const lines = result.characters.map((character) => {
    if (character.result === "stopped") return `- ${character.name}：已停止`;
    if (character.result === "already_running")
      return `- ${character.name}：已在 ${character.target} 掛機`;
    return `- ${character.name}：Lv${character.level}，${character.from} → ${character.target}（${character.moves} 步）${character.fallback ? "，使用安全回退" : ""}`;
  });
  if (!lines.length) lines.push("- 沒有需要變更的角色");
  return `${action}；共送出 ${result.commands} 個遊戲指令。\n${lines.join("\n")}`;
}
