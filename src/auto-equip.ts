import {
  type AutoIdleCharacter,
  parseCharacterList,
  parseSelectedCharacter,
} from "./auto-idle.js";
import type { Game, GameMessage } from "./game.js";
import { plainGameText } from "./game-text.js";

const MAX_COMMANDS = 20;

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
      if (parsed !== undefined) return parsed;
    }
  }
  return undefined;
}

export function parseAutoEquipConfirmation(text: string) {
  const plain = plainGameText(text).trim();
  if (/失敗|錯誤|無法|不能/u.test(plain)) return undefined;
  if (!/(?:一鍵裝備|自動裝備|最強裝備)/u.test(plain)) return undefined;
  if (
    /(?:完成|成功|已(?:經)?(?:自動)?裝備|已(?:經)?是|目前|沒有可換|沒有.*更強)/u.test(
      plain,
    )
  )
    return true;

  // 現行遊戲成功回覆不含「完成」，而是列出已替換的部位與結果屬性。
  const hasChangedSlot =
    /^\s*(?:武器|身體|頭部|手部|腳部|飾品)[：:]\s*.+\s+→\s+.+$/mu.test(plain);
  const hasResultStats =
    /^ATK[：:]\s*\d+\s+DEF[：:]\s*\d+\s+INT[：:]\s*\d+$/mu.test(plain);
  return hasChangedSlot && hasResultStats ? true : undefined;
}

export class AutoEquip {
  private commands = 0;

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
    if (this.commands >= MAX_COMMANDS)
      throw new Error(`Auto Equip 已達 ${MAX_COMMANDS} 個指令上限。`);
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

  private switchCharacter(character: AutoIdleCharacter, signal?: AbortSignal) {
    return this.command(
      `/switch ${character.name}`,
      (messages) => {
        const selected = latestParsed(messages, (text) =>
          parseSelectedCharacter(text, character.name),
        );
        if (!selected || (character.idle && !selected.idleSettled))
          return undefined;
        return selected;
      },
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
    const characters = await this.listCharacters(signal);
    const original = characters.find((character) => character.active);
    if (!original) throw new Error("/chars 未標示目前角色。");
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
