import {
  type AutoIdleCharacter,
  parseCharacterList,
  parseSelectedCharacter,
} from "./auto-idle.js";
import type { Game, GameMessage } from "./game.js";
import { plainGameText } from "./game-text.js";

const MAX_COMMANDS = 21;
const COMBAT_BLOCKED = "combat_blocked" as const;

export interface AutoEquipCharacterResult {
  name: string;
  job: string;
  level: number;
}

export interface AutoEquipResult {
  commands: number;
  characters: AutoEquipCharacterResult[];
}

type GameActionResult = Awaited<ReturnType<Game["act"]>>;
type Progress = (message: string) => void;

function latestParsed<T>(
  messages: readonly GameMessage[],
  parser: (text: string) => T | undefined,
) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message.outgoing) {
      const parsed = parser(message.text);
      if (parsed !== undefined) {
        return parsed;
      }
    }
  }
}

export function parseSwitchCombatBlock(text: string) {
  return /^⚔️\s*戰鬥中無法切換角色/u.test(plainGameText(text).trim())
    ? true
    : undefined;
}

export function parseFleeConfirmation(text: string) {
  const plain = plainGameText(text).trim();
  if (/失敗|無法|不能/u.test(plain)) {
    return;
  }
  return /(?:成功逃(?:跑|離)|逃(?:跑|離)成功|逃離(?:了)?戰鬥|逃跑了|已(?:經)?(?:逃離|脫離)(?:了)?戰鬥)/u.test(
    plain,
  )
    ? true
    : undefined;
}

export function parseAutoEquipConfirmation(text: string) {
  const plain = plainGameText(text).trim();
  if (/失敗|錯誤|無法|不能/u.test(plain)) {
    return;
  }
  if (!/(?:一鍵裝備|自動裝備|最強裝備)/u.test(plain)) {
    return;
  }
  if (
    /(?:完成|成功|已(?:經)?(?:自動)?裝備|已(?:經)?是|目前|沒有可換|沒有.*更強)/u.test(
      plain,
    )
  ) {
    return true;
  }

  // 現行遊戲成功回覆不含「完成」，而是列出已替換的部位與結果屬性。
  const hasChangedSlot =
    /^\s*(?:武器|身體|頭部|手部|腳部|飾品)[：:]\s*.+\s+→\s+.+$/mu.test(plain);
  const hasResultStats =
    /^ATK[：:]\s*\d+\s+DEF[：:]\s*\d+\s+INT[：:]\s*\d+$/mu.test(plain);
  return hasChangedSlot && hasResultStats ? true : undefined;
}

export class AutoEquip {
  private commands = 0;
  private combatRecoveryUsed = false;

  constructor(
    private readonly game: Pick<Game, "act" | "stop">,
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
    if (this.commands >= MAX_COMMANDS) {
      throw new Error(`Auto Equip 已達 ${MAX_COMMANDS} 個指令上限。`);
    }
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
          } catch {}
        }),
      signal,
    );
  }

  private async switchCharacter(
    character: AutoIdleCharacter,
    signal?: AbortSignal,
  ): Promise<AutoEquipCharacterResult> {
    const outcome = await this.command(
      `/switch ${character.name}`,
      (messages) =>
        latestParsed(messages, (text) => {
          const selected = parseSelectedCharacter(text, character.name);
          if (selected && (!character.idle || selected.idleSettled)) {
            return selected;
          }
          return parseSwitchCombatBlock(text) ? COMBAT_BLOCKED : undefined;
        }),
      signal,
    );
    if (outcome !== COMBAT_BLOCKED) {
      return outcome;
    }
    if (this.combatRecoveryUsed) {
      throw new Error("切換角色再次被戰鬥阻擋，已停止且不會繼續逃跑。");
    }

    this.combatRecoveryUsed = true;
    this.progress("目前角色仍在戰鬥，正在嘗試逃跑…");
    await this.fleeCurrent(signal);
    return this.switchCharacter(character, signal);
  }

  private fleeCurrent(signal?: AbortSignal) {
    return this.command(
      "/flee",
      (messages) => latestParsed(messages, parseFleeConfirmation),
      signal,
    );
  }

  private equipCurrent(signal?: AbortSignal) {
    return this.command(
      "/autoequip",
      (messages) => latestParsed(messages, parseAutoEquipConfirmation),
      signal,
    );
  }

  async run(signal?: AbortSignal): Promise<AutoEquipResult> {
    this.commands = 0;
    this.combatRecoveryUsed = false;
    const characters = await this.listCharacters(signal);
    const original = characters.find((character) => character.active);
    if (!original) {
      throw new Error("/chars 未標示目前角色。");
    }
    const ordered = [
      ...characters.filter((character) => !character.active),
      original,
    ];
    let currentName = original.name;
    const completed: AutoEquipCharacterResult[] = [];

    for (const character of ordered) {
      signal?.throwIfAborted();
      this.progress(`正在為 ${character.name} 一鍵裝備…`);
      let selected: AutoEquipCharacterResult = character;
      if (character.name !== currentName) {
        selected = await this.switchCharacter(character, signal);
        currentName = selected.name;
      }
      await this.equipCurrent(signal);
      completed.push({
        name: selected.name,
        job: selected.job,
        level: selected.level,
      });
    }

    return { commands: this.commands, characters: completed };
  }
}

export function formatAutoEquipResult(result: AutoEquipResult) {
  const lines = result.characters.map(
    (character) =>
      `- ${character.name}：${character.job} Lv${character.level}，已執行一鍵裝備`,
  );
  return `所有角色一鍵裝備完成；共送出 ${result.commands} 個遊戲指令。\n${lines.join("\n")}`;
}
