import type { GameMessage } from "./game.js";
import { plainGameText } from "./game-text.js";

export interface Observation<T> {
  id: number;
  date: number;
  revision: string;
  source: string;
  value: T;
}

export interface RoomDetails {
  name: string;
  exits: string;
  monsters: string[];
  shop: boolean;
}

function update<T>(
  previous: Observation<T> | undefined,
  message: GameMessage,
  source: string,
  value: T,
) {
  if (
    previous &&
    (previous.id > message.id ||
      (previous.id === message.id && previous.revision === message.revision))
  )
    return previous;
  return {
    id: message.id,
    date: message.date,
    revision: message.revision,
    source,
    value,
  };
}

export class AdventureStatusState {
  location?: Observation<string>;
  room?: Observation<RoomDetails>;
  idle?: Observation<string[]>;
  idleStatus?: Observation<string>;
  task?: Observation<string[]>;
  skills?: Observation<string[]>;

  observe(message: GameMessage, isStatus: boolean) {
    if (message.outgoing || message.text.length > 12000) return;
    const lines = plainGameText(message.text)
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    const buttons = Array.isArray(message.buttons)
      ? message.buttons
          .filter(
            (button) =>
              button &&
              typeof button.text === "string" &&
              button.text.length <= 512 &&
              button.kind === "callback",
          )
          .slice(0, 100)
          .map((button) => plainGameText(button.text).replace(/\n/g, " "))
      : [];
    const first = lines[0] ?? "";
    const idleReport = /^🐾 掛機\s+\d+\s*分/.test(first);
    const idleStart = first.startsWith("🐾 開始掛機！");
    if (idleReport || idleStart) {
      const report = lines.filter(
        (line) =>
          /^(?:🐾|📍|目前目標：|EXP\s*\+|🎉|Lv\d+\s)/.test(line) ||
          /×\d+$/.test(line),
      );
      if (idleReport)
        report.push("以上為回報當時的預估，非已領取餘額；不累加歷次回報。");
      this.idle = update(
        this.idle,
        message,
        idleReport ? "掛機回報" : "掛機開始",
        report,
      );
    }

    if (isStatus) {
      this.idleStatus = update(
        this.idleStatus,
        message,
        "/status",
        lines.find((line) => line.startsWith("🐾 掛機中")) ??
          "此 /status 未標示掛機中",
      );
    }
    if (isStatus || idleReport) {
      const position = lines.find((line) =>
        isStatus ? /^位置[：:]/.test(line) : /^📍 現在位置[：:]/.test(line),
      );
      if (position)
        this.location = update(
          this.location,
          message,
          isStatus ? "/status" : "掛機回報",
          position.replace(/^(?:📍 現在位置|位置)[：:]\s*/, ""),
        );
    }

    const exits = lines.find((line) => line.startsWith("🚪 出口："));
    const moving = /^你往.+走去…$/.test(first);
    // Only room messages with the observed exit marker qualify, not idle menus.
    if (exits && !isStatus && !idleReport && !idleStart) {
      const name = moving ? lines[1] : first;
      if (name && !name.includes("：") && !/^\//.test(name)) {
        const counts = new Map<string, number>();
        for (const button of buttons.filter((text) =>
          /^⚔️\s*.+\s+Lv\d+$/.test(text),
        ))
          counts.set(button, (counts.get(button) ?? 0) + 1);
        const monsters = [...counts].map(
          ([text, count]) => `${text}${count > 1 ? ` ×${count}` : ""}`,
        );
        if (!monsters.length) {
          const monsterLine = lines.find((line) => line.startsWith("👾"));
          if (monsterLine) monsters.push(monsterLine);
        }
        this.room = update(
          this.room,
          message,
          moving ? "移動回覆" : "/look 格式",
          {
            name,
            exits,
            monsters,
            shop: lines.some((line) => line.startsWith("🛍️ 商店在此")),
          },
        );
        this.location = update(
          this.location,
          message,
          moving ? "移動回覆" : "/look 格式",
          name,
        );
      }
    }

    const tasks = lines.filter((line) =>
      /^📜 新任務【|^✅ 任務完成[：:]/.test(line),
    );
    if (tasks.length) this.task = update(this.task, message, "任務通知", tasks);
    const skills = [
      ...new Set(buttons.filter((text) => /\s\d+MP$/.test(text))),
    ];
    if (skills.length)
      this.skills = update(this.skills, message, "技能按鈕", skills);
  }

  get matchingRoom() {
    // Never attach old exits or monsters to a newer, different location.
    return this.room &&
      this.location &&
      this.room.value.name.replace(/\s/g, "") ===
        this.location.value.replace(/\s/g, "")
      ? this.room
      : undefined;
  }
}
