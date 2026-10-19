import { encode } from "gpt-tokenizer/encoding/o200k_base";
import { expect, test } from "vitest";
import { readonlyToolResult } from "../src/bears-readonly-result.js";
import { gameToolResult } from "../src/bears-result.js";
import { toolResult } from "../src/output.js";
import {
  inventoryText,
  message,
  NOW,
  statusText,
} from "./fixtures/workflow.js";

test("五種唯讀資料固定格式基準；只比較輸出表示法，不聲稱減少網路查詢", async () => {
  const fixtures = [
    [
      "world",
      {
        source: "https://bearofbears.net/state.json",
        note: "公開快照，不證存活或即時位置",
        total: 30,
        nextOffset: null,
        rooms: Array.from({ length: 30 }, (_, index) => ({
          id: index + 1,
          name: `測試房${index + 1}`,
          description: "公開地圖房間",
          safe: true,
          boss: false,
          exits: { 東: index + 2 },
        })),
      },
    ],
    [
      "bosses",
      {
        kind: "bosses",
        note: "機率不是掉落保證",
        total: 10,
        nextOffset: null,
        evolution: [],
        entries: Array.from({ length: 10 }, (_, index) => ({
          boss: `測試王${index + 1}`,
          level: 10,
          loc: "測試房",
          drops: [
            {
              name: "測試王裝",
              prob_pct: 5,
              stats: "ATK+10",
              passive: "未知",
              material: false,
            },
          ],
        })),
      },
    ],
    [
      "recipes",
      {
        kind: "recipes",
        note: "公開配方，不證本人持有或含稅總價",
        total: 10,
        nextOffset: null,
        entries: Array.from({ length: 10 }, (_, index) => ({
          out_name: `測試成品${index + 1}`,
          essence: 10,
          gold: 100000,
          materials: [{ name: "測試材料", qty: 2 }],
        })),
      },
    ],
    [
      "public-character",
      {
        name: "測試熊",
        note: "公開頁面可能過期",
        score: 12000,
        equippedPower: 12000,
        lifetimeRarePoints: 0,
        rank: null,
        lastActivity: null,
        equipment: Array.from({ length: 6 }, (_, index) => ({
          slot: `測試部位${index + 1}`,
          name: "測試裝備",
          stats: "DEF+10",
          score: 2000,
        })),
      },
    ],
    [
      "equipment",
      {
        applicable: false,
        recommendations: [],
        remainingRecommendations: 0,
        blockers: ["本人背包不完整"],
        completeness: { declared: 2, listed: 1, complete: false },
      },
    ],
  ] as const;
  const report = [];
  for (const [name, value] of fixtures) {
    const old = await toolResult(value);
    const modern = await readonlyToolResult(value);
    const stableId = "00000000-0000-4000-8000-000000000000";
    const before = old.content
      .map((block) => block.text)
      .join("\n")
      .replaceAll(old.details.bearsOriginal.sourceId, stableId);
    const after = JSON.stringify(modern.structuredContent).replaceAll(
      modern.details.bearsOriginal.sourceId,
      stableId,
    );
    expect(modern.structuredContent).toMatchObject(value);
    expect(modern.structuredContent.outputComplete).toBe(true);
    report.push({
      name,
      beforeBytes: Buffer.byteLength(before),
      afterBytes: Buffer.byteLength(after),
      beforeTokens: encode(before).length,
      afterTokens: encode(after).length,
    });
  }
  expect(report).toMatchSnapshot();
});

test("固定小型回覆的 Codemode 可見 bytes／o200k_base token 基準；保留必要證據", async () => {
  const lines = inventoryText().split("\n");
  const fixtures = [
    ["status", [statusText()]],
    ["inventory", [inventoryText()]],
    [
      "inventory-multipage",
      [lines.slice(0, 2).join("\n"), lines[2], lines.slice(3).join("\n")],
    ],
    ["no-update", []],
  ] as const;
  const report = [];
  for (const [name, texts] of fixtures) {
    const value = {
      delivery: "submitted",
      observation: texts.length > 0 ? "bot_updates_observed" : "no_update_yet",
      messages: texts.map((text, index) =>
        message(index + 1, text, false, NOW / 1000),
      ),
      note: "Updates may be unrelated or incomplete. This does not prove action success. Use bears_history for late replies; never blindly resend.",
    };
    const old = await toolResult(value);
    const modern = await gameToolResult(value);
    const stableId = "00000000-0000-4000-8000-000000000000";
    const before = old.content
      .map((block) => block.text)
      .join("\n")
      .replaceAll(old.details.bearsOriginal.sourceId, stableId);
    const after = JSON.stringify(modern.structuredContent).replaceAll(
      modern.details.bearsOriginal.sourceId,
      stableId,
    );
    expect(modern.structuredContent.messages).toEqual(value.messages);
    report.push({
      name,
      beforeBytes: Buffer.byteLength(before),
      afterBytes: Buffer.byteLength(after),
      beforeTokens: encode(before).length,
      afterTokens: encode(after).length,
    });
  }
  expect(report).toMatchInlineSnapshot(`
    [
      {
        "afterBytes": 572,
        "afterTokens": 216,
        "beforeBytes": 700,
        "beforeTokens": 252,
        "name": "status",
      },
      {
        "afterBytes": 727,
        "afterTokens": 265,
        "beforeBytes": 855,
        "beforeTokens": 301,
        "name": "inventory",
      },
      {
        "afterBytes": 1047,
        "afterTokens": 395,
        "beforeBytes": 1307,
        "beforeTokens": 475,
        "name": "inventory-multipage",
      },
      {
        "afterBytes": 229,
        "afterTokens": 65,
        "beforeBytes": 288,
        "beforeTokens": 78,
        "name": "no-update",
      },
    ]
  `);
});
