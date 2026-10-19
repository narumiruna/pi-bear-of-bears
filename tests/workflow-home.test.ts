import { expect, test } from "vitest";
import { homeFacts } from "../src/workflow-parsers.js";

// 格式取自 2026-10-19 /home 761325；金額為合成值，不是即時餘額。
const liveHome = `🏡 熊熊溫暖的家　房屋 Lv1/5
🐾 寵物 0/3　🏦 金庫 0G　身上 1,234,567G
🖼️ 珍藏 0 件（無上限；牆上會掛出前排）
🪑 還沒買額外家具（客廳已有書架／窗／沙發／碗）。

📦 下一級 Lv2：寵物上限 4、小屋變寬　費用 1,000,000G
　在家輸入 /expand 或 /home upgrade`;

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
