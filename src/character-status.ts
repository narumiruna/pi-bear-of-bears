import { AdventureStatusState } from "./adventure-status.js";
import type { GameMessage } from "./game.js";
import { plainGameText } from "./game-text.js";
import type { WatchStatus } from "./watch.js";

export const CHARACTER_MESSAGES_EVENT = "bears:character-messages";

export interface CharacterStatus {
  id: number;
  date: number;
  revision: string;
  title: string;
  sections: string[][];
}

export function parseCharacterStatus(
  message: Pick<GameMessage, "id" | "date" | "revision" | "outgoing" | "text">,
): CharacterStatus | undefined {
  if (message.outgoing || message.text.length > 12_000) {
    return undefined;
  }
  const lines = plainGameText(message.text)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !/^[─━\-═]+$/.test(line));
  const title = lines.shift();
  // Match the observed /status layout, not combat reports or other players in /look.
  if (
    !(
      title &&
      /\s(?:二轉)?Lv\d+\s*$/.test(title) &&
      lines.some((line) =>
        /^HP[：:]\s*\d+\/\d+\s+MP[：:]\s*\d+\/\d+/.test(line),
      ) &&
      lines.some((line) => /^EXP[：:]\s*\d+\/\d+/.test(line)) &&
      lines.some((line) => /^位置[：:]/.test(line))
    )
  ) {
    return undefined;
  }
  const vitals: string[] = [];
  const attributes: string[] = [];
  const progress: string[] = [];
  const location: string[] = [];
  for (const line of lines) {
    if (/^HP[：:]/.test(line)) {
      vitals.push(line);
    } else if (/^(?:ATK|DEF|INT|AGI)[：:]/.test(line)) {
      attributes.push(line);
    } else if (/^(?:金幣[：:]|EXP[：:]|(?:二轉)?Lv\d+\s)/.test(line)) {
      progress.push(line);
    } else {
      location.push(line); // Preserve idle notes and future fields without inventing values.
    }
  }
  return {
    id: message.id,
    date: message.date,
    revision: message.revision,
    title,
    sections: [vitals, attributes, progress, location].filter(
      (section) => section.length > 0,
    ),
  };
}

export class CharacterStatusState {
  snapshot?: CharacterStatus;
  readonly adventure = new AdventureStatusState();
  monitoring?: WatchStatus;
  lastMessageDate?: number;
  private newestMessageId = 0;

  get hasNewerActivity() {
    return Boolean(this.snapshot && this.newestMessageId > this.snapshot.id);
  }

  observe(value: unknown): boolean {
    if (!Array.isArray(value)) {
      return false;
    }
    let changed = false;
    for (const item of value) {
      if (
        !item ||
        typeof item !== "object" ||
        !Number.isSafeInteger(item.id) ||
        item.id <= 0 ||
        typeof item.date !== "number" ||
        !Number.isFinite(item.date) ||
        typeof item.text !== "string" ||
        typeof item.outgoing !== "boolean" ||
        typeof item.revision !== "string"
      ) {
        continue;
      }
      if (item.id > this.newestMessageId) {
        this.newestMessageId = item.id;
        this.lastMessageDate = item.date;
        changed = true;
      }
      const status = parseCharacterStatus(item);
      if (!item.outgoing) {
        this.adventure.observe(item, Boolean(status));
        changed = true;
      }
      if (
        status &&
        (!this.snapshot ||
          status.id > this.snapshot.id ||
          (status.id === this.snapshot.id &&
            status.revision !== this.snapshot.revision))
      ) {
        this.snapshot = status;
        changed = true;
      }
    }
    return changed;
  }
}
