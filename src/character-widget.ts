import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import type { Observation } from "./adventure-status.js";
import type { CharacterStatusState } from "./character-status.js";

export type WidgetMode = "compact" | "full";
const time = (date: number) =>
  new Date(date * 1000).toLocaleString("zh-TW", { hour12: false });
const origin = (observation: Observation<unknown>) =>
  `${observation.source} · ${time(observation.date)}`;

export function renderCharacterWidget(
  state: CharacterStatusState,
  width: number,
  theme: Pick<Theme, "fg" | "bold">,
  notice?: string,
  mode: WidgetMode = "compact",
): string[] {
  if (width < 1) return [];
  const border = theme.fg("borderMuted", "─".repeat(width));
  const lines: string[] = [border];
  const add = (text: string) => {
    const wrapped = mode === "full" ? wrapTextWithAnsi(text, width) : [text];
    for (const line of wrapped) lines.push(truncateToWidth(line, width));
  };
  const section = (heading: string, content: string[]) => {
    add(theme.fg("accent", heading));
    for (const line of content) add(line);
    lines.push(border);
  };
  add(
    theme.fg(
      "muted",
      `同步：${state.monitoring ?? "未知"} · ${mode === "full" ? "詳細" : "精簡"}${state.lastMessageDate ? ` · 最近訊息 ${time(state.lastMessageDate)}` : ""}${notice ? ` · ${notice}` : ""}`,
    ),
  );
  const snapshot = state.snapshot;
  if (!snapshot) {
    section("🐻 角色狀態", [
      notice ?? "尚未讀到 /status。請在 Telegram 輸入 /status。",
    ]);
  } else {
    const [vitals = [], attributes = [], progress = []] = snapshot.sections;
    const character =
      mode === "full"
        ? [snapshot.title, ...vitals, ...attributes, ...progress]
        : [
            snapshot.title,
            vitals.join("　"),
            attributes.join("　"),
            progress.join("　"),
          ];
    section(
      `🐻 /status · ${time(snapshot.date)}${state.hasNewerActivity ? " · 有較新活動" : " · 最後觀測"}`,
      character,
    );
  }
  const adventure = state.adventure;
  if (adventure.idle || adventure.idleStatus) {
    const report = adventure.idle;
    const content: string[] = [];
    if (adventure.idleStatus)
      content.push(
        `${adventure.idleStatus.value}（${origin(adventure.idleStatus)}）`,
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
      `🐾 掛機${report ? ` · ${origin(report)} · 預估／最後回報` : " · /status 最後觀測"}`,
      content,
    );
  }
  if (adventure.location) {
    const room = adventure.matchingRoom;
    const content = [adventure.location.value];
    if (room) {
      content.push(`${room.value.exits}${room.value.shop ? " · 🛍️有商店" : ""}`);
      content.push(
        `怪物：${room.value.monsters.join("、") || "此回覆未列出"}（${origin(room)}）`,
      );
    } else content.push("出口／怪物：未取得此位置的房間詳情");
    section(`📍 位置 · ${origin(adventure.location)}`, content);
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
      `✨ 技能 · ${origin(adventure.skills)} · 非冷卻狀態`,
      mode === "full"
        ? adventure.skills.value
        : [adventure.skills.value.join("　")],
    );
  }
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
