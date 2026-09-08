import { readFileSync } from "node:fs";
import { visibleWidth } from "@earendil-works/pi-tui";
import { expect, test } from "vitest";
import {
  CharacterStatusState,
  parseCharacterStatus,
} from "../src/character-status.js";
import { renderCharacterWidget } from "../src/character-widget.js";

const text = readFileSync(
  new URL("./fixtures/character-status.txt", import.meta.url),
  "utf8",
);
const message = {
  id: 10,
  date: 1788772908,
  revision: "a",
  outgoing: false,
  text,
};
const theme = {
  fg: (_color: unknown, text: string) => text,
  bold: (text: string) => text,
};

test("recognizes the observed status layout and preserves detailed values and estimates", () => {
  const status = parseCharacterStatus(message);
  expect(status?.title).toBe("✨ 測試熊　法熊 Lv10");
  expect(status?.sections).toHaveLength(4);
  expect(status?.sections.flat()).toContain("EXP：61/1030（本級）　含掛機預估");
  expect(status?.sections.flat()).toContain("ATK：8 (8+0)　DEF：4 (4+0)");
  expect(status?.sections.flat()).toContain(
    "🐾 掛機中（森林小徑）— /stopidle 結算",
  );
});

test("ignores outgoing messages, partial combat updates and room rosters", () => {
  expect(parseCharacterStatus({ ...message, outgoing: true })).toBeUndefined();
  expect(
    parseCharacterStatus({
      ...message,
      text: "HP：10/90　MP：20/100\nEXP：1/100\n位置：村莊",
    }),
  ).toBeUndefined();
  expect(
    parseCharacterStatus({
      ...message,
      text: "👤 其他玩家：\n測試熊 法熊 Lv10",
    }),
  ).toBeUndefined();
});

test("retains the latest complete status, detects subsequent activity and accepts edits", () => {
  const state = new CharacterStatusState();
  state.observe([message]);
  state.observe([{ ...message, id: 9, text: text.replace("Lv10", "Lv1") }]);
  expect(state.snapshot?.id).toBe(10);
  state.observe([{ ...message, id: 11, outgoing: true, text: "/go 東" }]);
  expect(state.hasNewerActivity).toBe(true);
  state.observe([{ ...message, id: 12 }]);
  expect(state.hasNewerActivity).toBe(false);
  state.observe([
    { ...message, id: 12, revision: "b", text: text.replace("90/90", "80/90") },
  ]);
  expect(state.snapshot?.sections[0][0]).toContain("80/90");
  expect(state.observe([null, {}, { ...message, id: -1 }])).toBe(false);
});

test("renders horizontal dividers and respects CJK and emoji widths", () => {
  const state = new CharacterStatusState();
  state.observe([message]);
  for (const width of [0, 1, 12, 40, 80, 120]) {
    const lines = renderCharacterWidget(state, width, theme);
    expect(lines.length).toBeLessThanOrEqual(24);
    for (const line of lines)
      expect(visibleWidth(line)).toBeLessThanOrEqual(width);
    if (width) {
      expect(lines[0]).toBe("─".repeat(width));
      expect(lines.at(-1)).toBe("─".repeat(width));
    }
  }
  const rendered = renderCharacterWidget(
    state,
    120,
    theme,
    undefined,
    "full",
  ).join("\n");
  for (const field of [
    "HP",
    "MP",
    "ATK",
    "DEF",
    "INT",
    "AGI",
    "金幣",
    "EXP",
    "位置",
    "掛機中",
    "含掛機預估",
  ])
    expect(rendered).toContain(field);
});

test("compact hides inactive idle observation while full retains its source", () => {
  const state = new CharacterStatusState();
  state.observe([{ ...message, text: text.replace(/^🐾 掛機中.*$/m, "") }]);
  const compact = renderCharacterWidget(state, 120, theme);
  expect(compact.join("\n")).not.toContain("掛機中");
  const full = renderCharacterWidget(state, 120, theme, undefined, "full").join(
    "\n",
  );
  expect(full).toContain("🐾 掛機 · /status 最後觀測");
  expect(full).toContain("此 /status 未標示掛機中（/status ·");
});

test("compact stats wrap instead of dropping fields at moderate widths", () => {
  const state = new CharacterStatusState();
  state.observe([message]);
  const lines = renderCharacterWidget(state, 60, theme);
  for (const field of ["HP", "MP", "EXP"])
    expect(lines.join("\n")).toContain(field);
  expect(lines.every((line) => visibleWidth(line) <= 60)).toBe(true);
  for (const field of ["ATK", "DEF", "INT", "AGI", "（本級）"])
    expect(lines.join("\n")).not.toContain(field);
  expect(lines.join("\n")).toContain("金幣");
});

test("notices appear once and cannot be truncated behind sync metadata", () => {
  const state = new CharacterStatusState();
  state.monitoring = "listening";
  state.lastMessageDate = message.date;
  const rendered = renderCharacterWidget(state, 40, theme, "連線失敗").join(
    "\n",
  );
  expect(rendered.match(/連線失敗/g)).toHaveLength(1);
});

test("strips terminal control sequences and preserves empty/error states", () => {
  const status = parseCharacterStatus({
    ...message,
    text: text.replace("測試熊", "\u001b[31m測試熊\u001b[0m\u202e"),
  });
  expect(status?.title).not.toContain("\u001b");
  expect(status?.title).not.toContain("\u202e");
  const state = new CharacterStatusState();
  expect(renderCharacterWidget(state, 80, theme).join("\n")).toContain(
    "尚未讀到 /status",
  );
  expect(
    renderCharacterWidget(state, 80, theme, "連線失敗").join("\n"),
  ).toContain("連線失敗");
});
