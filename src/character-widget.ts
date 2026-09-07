import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import type { CharacterStatusState } from "./character-status.js";

export function renderCharacterWidget(
  state: CharacterStatusState,
  width: number,
  theme: Pick<Theme, "fg" | "bold">,
  notice?: string,
): string[] {
  if (width < 1) return [];
  const border = theme.fg("borderMuted", "─".repeat(width));
  const lines: string[] = [border];
  const add = (text: string) => {
    for (const line of wrapTextWithAnsi(text, width))
      lines.push(truncateToWidth(line, width));
  };
  const snapshot = state.snapshot;
  if (!snapshot) {
    add(theme.fg("accent", "🐻 角色狀態"));
    add(
      theme.fg(
        "muted",
        notice ?? "尚未讀到 /status。請在 Telegram 輸入 /status。",
      ),
    );
  } else {
    const timestamp = new Date(snapshot.date * 1000).toLocaleString("zh-TW", {
      hour12: false,
    });
    add(
      theme.fg(
        "muted",
        `最近 /status：${timestamp}${state.hasNewerActivity ? " · 有較新活動，數值可能已變動" : " · 非即時推算"}`,
      ),
    );
    add(theme.fg("accent", theme.bold(snapshot.title)));
    snapshot.sections.forEach((section, index) => {
      if (index > 0) lines.push(border);
      for (const line of section) add(line);
    });
    if (notice) add(theme.fg("warning", notice));
  }
  if (lines.length > 23) {
    lines.splice(22);
    lines.push(
      truncateToWidth(
        "…版面已截短；完整狀態請查看 Telegram /status 回覆。",
        width,
      ),
    );
  }
  lines.push(border);
  return lines;
}
