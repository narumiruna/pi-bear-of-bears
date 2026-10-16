import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { parseCharacterStatus } from "../src/character-status.js";

const text = readFileSync(
  new URL("./fixtures/character-status.txt", import.meta.url),
  "utf8",
);
const message = {
  id: 10,
  date: 1_788_772_908,
  revision: "a",
  outgoing: false,
  text,
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

test("recognizes the observed second-advance status title and progress", () => {
  const status = parseCharacterStatus({
    ...message,
    text: text
      .replace("✨ 測試熊　法熊 Lv10", "🔮 測試熊　賢者熊 二轉Lv25")
      .replace("Lv10 ▱▱▱▱▱▱▱▱▱▱ 5%", "二轉Lv25 48%"),
  });
  expect(status?.title).toBe("🔮 測試熊　賢者熊 二轉Lv25");
  expect(status?.sections.flat()).toContain("二轉Lv25 48%");
});

test("recognizes a max-level status without retaining the previous character", () => {
  const status = parseCharacterStatus({
    ...message,
    text: text
      .replace("✨ 測試熊　法熊 Lv10", "🎋 滿級熊　道熊 Lv100")
      .replace("EXP：61/1030（本級）　含掛機預估", "EXP：滿級")
      .replace(
        "Lv10 ▱▱▱▱▱▱▱▱▱▱ 5%",
        "Lv100 ▰▰▰▰▰▰▰▰▰▰ 滿級（可 /advance 二轉）",
      ),
  });
  expect(status?.title).toBe("🎋 滿級熊　道熊 Lv100");
  expect(status?.sections.flat()).toContain("EXP：滿級");
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

test("解析角色狀態時移除 terminal control sequences", () => {
  const status = parseCharacterStatus({
    ...message,
    text: text.replace("測試熊", "\u001b[31m測試熊\u001b[0m\u202e"),
  });
  expect(status?.title).not.toContain("\u001b");
  expect(status?.title).not.toContain("\u202e");
});

test("保留來源與未知欄位，拒絕超過長度上限的訊息", () => {
  const status = parseCharacterStatus({
    ...message,
    text: `${text}\n新欄位：保留原文`,
  });
  expect(status).toMatchObject({
    id: message.id,
    date: message.date,
    revision: message.revision,
  });
  expect(status?.sections.flat()).toContain("新欄位：保留原文");
  expect(
    parseCharacterStatus({
      ...message,
      text: `${text}\n${"熊".repeat(12_000)}`,
    }),
  ).toBeUndefined();
});
