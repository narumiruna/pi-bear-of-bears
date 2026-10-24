import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { homeFacts } from "../src/workflow-parsers.js";

// 既有原生格式；金額為合成值，不是即時餘額。
const liveHome = (
  JSON.parse(
    readFileSync(
      new URL("./fixtures/native-home.json", import.meta.url),
      "utf8",
    ),
  ) as { text: string }
).text;

test("原生家園同列餘額可解析，擴屋價格不當存款費用或入口", () => {
  expect(homeFacts(liveHome)).toEqual({
    cash: 1234567,
    vault: 0,
    fee: null,
    canDeposit: false,
  });
  expect(homeFacts(liveHome.replace("金庫 0G", "金庫 12,345G"))?.vault).toBe(
    12345,
  );
  expect(homeFacts(`背包\n${liveHome}`)).toBeUndefined();
});

test.each(["9007199254740992", "1,23", "NaN", "-1", "1.5", "1e3"])(
  "原生家園非法餘額 %s 不猜值或部分取值",
  (cash) => {
    expect(
      homeFacts(liveHome.replace("1,234,567G", `${cash}G`))?.cash,
    ).toBeNull();
  },
);

test("原生家園重複餘額列或與標籤餘額矛盾時不採第一筆", () => {
  const row = "🐾 寵物 0/3　🏦 金庫 1G　身上 2G";
  expect(homeFacts(`${liveHome}\n${row}`)).toMatchObject({
    cash: null,
    vault: null,
  });
  expect(homeFacts(`${liveHome}\n身上金幣：2\n金庫餘額：1`)).toMatchObject({
    cash: null,
    vault: null,
  });
});
