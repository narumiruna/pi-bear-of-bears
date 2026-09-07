import { readFileSync } from "node:fs";
import { visibleWidth } from "@earendil-works/pi-tui";
import { expect, test } from "vitest";
import { CharacterStatusState } from "../src/character-status.js";
import { renderCharacterWidget } from "../src/character-widget.js";
import type { GameMessage } from "../src/game.js";

const status = readFileSync(
  new URL("./fixtures/character-status.txt", import.meta.url),
  "utf8",
);
const idle =
  "🐾 掛機 1 分　共走過 1 個地點\n　📍 現在位置：🌿森林小徑\n　🐝小蜜蜂 ×15\n　EXP +135　🪙 +38\n　🎉 升級！等級 2！(HP+7 MP+8 ATK+1 DEF+1 INT+3)\n　Lv2 ▰▰▱▱▱▱▱▱▱▱ 29%\n👀 已掛機 1 分；以上為進度預估，掛機仍在繼續、尚未領取。";
const room =
  "你往東走去…\n🌿 森林小徑\n通往深林的崎嶇小路。\n👾 🐝小蜜蜂、🐝小蜜蜂\n🚪 出口：東→廢棄農場　南→鮭魚溪　西→村莊神社";
const task =
  "✅ 任務完成：初來乍到！獎勵：💰50 金幣\n📜 新任務【🛒採購 備戰糧草】在商店購買 🍯蜂蜜糖漿 ×2。/shop 查看、/buy 蜂蜜糖漿";
function message(id: number, text: string): GameMessage {
  return {
    id,
    text,
    outgoing: false,
    date: 1788772000 + id,
    revision: `r${id}`,
    buttons: [],
    hasMedia: false,
  };
}
const buttons: GameMessage["buttons"] = [
  { row: 1, column: 0, kind: "callback", text: "⚔️ 🐝小蜜蜂 Lv2" },
  { row: 2, column: 0, kind: "callback", text: "⚔️ 🐝小蜜蜂 Lv2" },
  { row: 3, column: 0, kind: "callback", text: "✨蜂蜜火球 20MP" },
  { row: 3, column: 1, kind: "callback", text: "✨蜂蜜護盾 15MP" },
];
const theme = {
  fg: (_color: unknown, text: string) => text,
  bold: (text: string) => text,
};

test("idle estimates never change the status balance, stats or level", () => {
  const state = new CharacterStatusState();
  state.observe([message(1, status), message(2, idle)]);
  expect(state.snapshot?.title).toContain("Lv10");
  expect(state.snapshot?.sections.flat()).toContain("金幣：1250");
  expect(state.adventure.idle?.value.join("\n")).toContain("EXP +135　🪙 +38");
  expect(state.adventure.idle?.value.join("\n")).toContain("非已領取餘額");
  state.observe([message(3, idle)]);
  expect(state.adventure.idle?.value.join("\n")).not.toContain("270");
  expect(state.adventure.location?.source).toBe("掛機回報");
  expect(state.adventure.location?.date).not.toBe(state.snapshot?.date);
});

test("room exits, monster counts and MP button costs come from observed menus", () => {
  const state = new CharacterStatusState();
  state.observe([{ ...message(2, room), buttons }]);
  expect(state.adventure.matchingRoom?.value.monsters).toEqual([
    "⚔️ 🐝小蜜蜂 Lv2 ×2",
  ]);
  expect(state.adventure.matchingRoom?.value.exits).toContain("東→廢棄農場");
  expect(state.adventure.skills?.value).toEqual([
    "✨蜂蜜火球 20MP",
    "✨蜂蜜護盾 15MP",
  ]);
  state.observe([message(3, status)]);
  expect(state.adventure.location?.value).toBe("🌫️ 腐葉溝壑");
  expect(state.adventure.matchingRoom).toBeUndefined();
});

test("task notices replace old objectives and older pages cannot roll them back", () => {
  const state = new CharacterStatusState();
  state.observe([message(4, task)]);
  expect(state.adventure.task?.value).toHaveLength(2);
  state.observe([message(5, "✅ 任務完成：備戰糧草！")]);
  state.observe([message(4, task)]);
  expect(state.adventure.task?.value).toEqual(["✅ 任務完成：備戰糧草！"]);
});

test("outgoing text, unrelated menus, and special buttons do not invent room or skill data", () => {
  const state = new CharacterStatusState();
  state.observe([{ ...message(1, task), outgoing: true }]);
  expect(state.adventure.task).toBeUndefined();
  state.observe([{ ...message(2, idle), buttons }]);
  expect(state.adventure.room).toBeUndefined();
  const other = new CharacterStatusState();
  other.observe([
    {
      ...message(1, "menu"),
      buttons: [{ ...buttons[2], kind: "unsupported" }],
    },
  ]);
  expect(other.adventure.skills).toBeUndefined();
});

test("compact layout removes repeated chrome without implying fresh status or ready skills", () => {
  const state = new CharacterStatusState();
  state.observe([message(1, status), { ...message(2, room), buttons }]);
  const lines = renderCharacterWidget(state, 120, theme);
  const rendered = lines.join("\n");
  expect(lines.filter((line) => /^─+$/.test(line))).toHaveLength(2);
  expect(lines.length).toBeLessThanOrEqual(14);
  expect(rendered).toContain("狀態可能過期");
  expect(rendered).toContain("冷卻未知");
  expect(rendered).not.toContain("非冷卻狀態");
  expect(rendered.match(/移動回覆/g)).toHaveLength(1);
  expect(rendered).toContain("掛機中");
});

test("all sections remain visible in compact mode and full mode retains details", () => {
  const state = new CharacterStatusState();
  state.observe([
    message(1, status),
    message(2, idle),
    { ...message(3, room), buttons },
    message(4, task),
  ]);
  state.monitoring = "listening";
  for (const mode of ["compact", "full"] as const) {
    for (const width of [1, 12, 40, 120]) {
      const lines = renderCharacterWidget(state, width, theme, undefined, mode);
      expect(lines.length).toBeLessThanOrEqual(mode === "compact" ? 24 : 48);
      for (const line of lines)
        expect(visibleWidth(line)).toBeLessThanOrEqual(width);
      expect(lines.at(-1)).toBe("─".repeat(width));
    }
    const text = renderCharacterWidget(state, 120, theme, undefined, mode).join(
      "\n",
    );
    for (const part of [
      "listening",
      "掛機回報",
      "位置",
      "任務",
      "技能",
      "20MP",
      "預估",
    ])
      expect(text).toContain(part);
  }
});
