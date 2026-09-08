import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import type { Observation } from "./adventure-status.js";
import type { CharacterStatusState } from "./character-status.js";

export type WidgetMode = "compact" | "full";
const time = (date: number) =>
  new Date(date * 1000).toLocaleString("zh-TW", { hour12: false });

export function renderCharacterWidget(
  state: CharacterStatusState,
  width: number,
  theme: Pick<Theme, "fg" | "bold">,
  notice?: string,
  mode: WidgetMode = "compact",
): string[] {
  if (width < 1) return [];
  const compact = mode === "compact";
  const timestamp = (date: number) =>
    compact
      ? new Date(date * 1000).toLocaleString("zh-TW", {
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: false,
        })
      : time(date);
  const origin = (observation: Observation<unknown>) =>
    `${observation.source} · ${timestamp(observation.date)}`;
  const border = theme.fg("borderMuted", "─".repeat(width));
  const lines: string[] = [border];
  const add = (text: string) => {
    const wrapped = wrapTextWithAnsi(text, width);
    for (const line of wrapped) lines.push(truncateToWidth(line, width));
  };
  const section = (heading: string, content: string[]) => {
    if (compact && content.length) {
      add(`${theme.fg("accent", heading)} · ${content[0]}`);
      for (const line of content.slice(1)) add(line);
    } else {
      add(theme.fg("accent", heading));
      for (const line of content) add(line);
    }
    if (!compact) lines.push(border);
  };
  add(
    theme.fg(
      "muted",
      `同步：${state.monitoring ?? "未知"} · ${mode === "full" ? "詳細" : "精簡"}${state.lastMessageDate ? ` · 最近訊息 ${timestamp(state.lastMessageDate)}` : ""}`,
    ),
  );
  if (notice) add(theme.fg("warning", notice));
  const snapshot = state.snapshot;
  if (!snapshot) {
    section("🐻 角色狀態", ["尚未讀到 /status。請在 Telegram 輸入 /status。"]);
  } else {
    const [vitals = [], attributes = [], progress = []] = snapshot.sections;
    const character =
      mode === "full"
        ? [snapshot.title, ...vitals, ...attributes, ...progress]
        : [
            vitals.join(" · "),
            progress
              .filter((line) => /^(?:金幣|EXP)[：:]/.test(line))
              .map((line) => line.replace(/（本級）/g, ""))
              .join(" · "),
          ];
    section(
      compact
        ? `🐻 ${theme.bold(snapshot.title.replace(/^✨\s*/, ""))}`
        : `🐻 ${state.hasNewerActivity ? "狀態可能過期" : "最後觀測"} · /status ${timestamp(snapshot.date)}`,
      compact
        ? [
            theme.fg(
              state.hasNewerActivity ? "warning" : "muted",
              `${state.hasNewerActivity ? "⚠ 狀態可能過期" : "最後觀測"} · ${timestamp(snapshot.date)}`,
            ),
            ...character,
          ]
        : character,
    );
  }
  const adventure = state.adventure;
  const inactiveIdle =
    adventure.idleStatus?.value === "此 /status 未標示掛機中";
  const idleSuperseded =
    inactiveIdle &&
    (!adventure.idle || adventure.idleStatus!.id >= adventure.idle.id);
  if (
    (adventure.idle || adventure.idleStatus) &&
    !(compact && idleSuperseded)
  ) {
    const report = adventure.idle;
    const content: string[] = [];
    if (adventure.idleStatus)
      content.push(
        compact
          ? adventure.idleStatus.value === "此 /status 未標示掛機中"
            ? "最後觀測未顯示掛機中"
            : adventure.idleStatus.value
          : `${adventure.idleStatus.value}（${origin(adventure.idleStatus)}）`,
      );
    if (report) {
      const detail =
        mode === "full"
          ? report.value
          : [
              [
                report.value[0],
                ...report.value
                  .slice(1)
                  .filter(
                    (line) => /^EXP\s*\+/.test(line) || /×\d+$/.test(line),
                  ),
              ].join("　"),
            ];
      content.push(...detail);
    }
    section(
      `🐾 掛機${report ? ` · ${origin(report)} · 預估／最後回報` : compact ? "" : " · /status 最後觀測"}`,
      content,
    );
  }
  if (adventure.location) {
    if (compact) lines.push(border);
    const room = adventure.matchingRoom;
    const content = compact
      ? [theme.fg("muted", `最後觀測 · ${timestamp(adventure.location.date)}`)]
      : [adventure.location.value];
    if (room) {
      content.push(
        `${compact ? room.value.exits.replace(/^🚪 出口：\s*/, "🚪 ") : room.value.exits}${room.value.shop ? " · 🛍️有商店" : ""}`,
      );
      content.push(
        `${compact ? "敵人觀測：" : "怪物："}${room.value.monsters.join("、") || "此回覆未列出"}${compact && room.id === adventure.location.id && room.revision === adventure.location.revision ? "" : `（${origin(room)}）`}`,
      );
    } else content.push("出口／怪物：未取得此位置的房間詳情");
    section(
      compact
        ? `📍 ${theme.bold(adventure.location.value)}`
        : `📍 位置 · ${origin(adventure.location)}`,
      content,
    );
  }
  if (adventure.task) {
    section(
      `📜 任務 · ${origin(adventure.task)} · 最後通知`,
      mode === "full"
        ? adventure.task.value
        : [
            adventure.task.value
              .filter((line) => line.startsWith("📜 新任務"))
              .at(-1) ??
              adventure.task.value.at(-1) ??
              "",
          ],
    );
  }
  if (adventure.skills) {
    section(
      compact
        ? "✨ 技能（冷卻未知）"
        : `✨ 技能 · 冷卻未知 · ${origin(adventure.skills)}`,
      mode === "full"
        ? adventure.skills.value
        : adventure.skills.value.map((skill) => skill.replace(/^✨\s*/, "")),
    );
  }
  if (compact) lines.push(border);
  const limit = mode === "full" ? 48 : 24;
  if (lines.length > limit) {
    lines.splice(limit - 2);
    lines.push(
      truncateToWidth(
        "…版面已截短；/bears-status full 查看詳細，完整內容見 Telegram。",
        width,
      ),
    );
    lines.push(border);
  }
  return lines;
}
