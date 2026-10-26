import { readFileSync } from "node:fs";
import { afterEach, expect, test } from "vitest";
import { ledgerFact, parseLedgerFacts } from "../src/ledger-facts.js";
import { ledgerHarness } from "./fixtures/ledger.js";
import { message, workflowHarness } from "./fixtures/workflow.js";

// 本人原文818840、818930、818932；只測解析與帳本，不證戰鬥安全。
const status = readFileSync(
  new URL("./fixtures/character-status-berserker-818840.txt", import.meta.url),
  "utf8",
).trimEnd();
const rest = "💤 充分休息後恢復了！\nHP：3040/3040　MP：422/422";
const open: ReturnType<typeof ledgerHarness>[] = [];
const setup = () => {
  const h = ledgerHarness();
  open.push(h);
  h.install();
  return h;
};
afterEach(() => {
  for (const h of open.splice(0)) {
    h.close();
  }
});

test("合併套裝status保留本人資源，不從描述另加防護", async () => {
  const h = setup();
  const result = await h.act("/status", status);
  expect(result.accounting).toMatchObject({
    state: "confirmed",
    hpAfter: 1520,
    mpAfter: 22,
  });
  expect(h.projection().account).toMatchObject({
    character: "なるみ_狂戰熊",
    maxHp: 3040,
    maxMp: 422,
    gold: { value: 23861826 },
  });
  const app = workflowHarness();
  app.observe(status, "/status");
  expect(app.store.status()?.value.attributes.DEF).toBe(5094);
});

test.each(["💨 你趁亂逃跑了！", "你沒有在戰鬥中。"])(
  "收刀只確認歸屬、不猜資源，原生休息用明示餘額：%s",
  async (flee) => {
    const h = setup();
    await h.act("/status", status);
    const stopped = await h.act("/flee", flee);
    expect(stopped.accounting).toMatchObject({
      state: "confirmed",
      hpAfter: null,
      mpAfter: null,
    });
    const recovered = await h.act("/rest", rest);
    expect(recovered.accounting).toMatchObject({
      state: "confirmed",
      hpAfter: 3040,
      mpAfter: 422,
    });
    expect(h.projection().account).toMatchObject({
      character: "なるみ_狂戰熊",
      recoveryCycles: 1,
      hp: { value: 3040, basis: "observed" },
      mp: { value: 422, basis: "observed" },
      mpRecovered: null,
    });
  },
);

test("已知恢復前MP才計算實補，原文最大值不沿用舊上限", async () => {
  const h = setup();
  await h.act("/status", status);
  const result = await h.act("/rest", rest);
  expect(result.accounting?.mpAfter).toBe(422);
  expect(h.projection().account?.mpRecovered).toBe(400);
  expect(h.projection().account?.gold.value).toBeNull();
  await h.act("/rest", "💤 充分休息後恢復了！\nHP：3200/3200　MP：450/450");
  expect(h.projection().account).toMatchObject({
    maxHp: 3200,
    maxMp: 450,
    mp: { value: 450 },
  });
});

test("無本人身分時，原生休息不能自行掛到前角", async () => {
  const h = setup();
  const result = await h.act("/rest", rest);
  expect(result.accounting).toMatchObject({
    state: "confirmed",
    mpAfter: null,
  });
  expect(h.projection().account).toBeNull();
});

test.each([
  `${rest}\n未知扣款`,
  `${rest}\nHP：3040/3040　MP：422/422`,
  rest.replace("3040/3040", "3041/3040"),
  rest.replace("422/422", "423/422"),
  rest.replace("3040/3040", "0/0"),
  rest.replace("422/422", "9007199254740992/9007199254740992"),
  rest.replace("422/422", "421/422"),
])("不完整／異常休息不建立資源事實：%s", (text) => {
  expect(
    ledgerFact(parseLedgerFacts(message(1, text), Date.now()), "rest"),
  ).toBeNull();
});

test.each([
  `${status}\n未知結算`,
  `${status}\n${status.split("\n").find((line) => line.startsWith("🎽 套裝加成："))}`,
  status.replace("地脈×2件", "地脈×0件"),
  status.replace("地脈×2件", "地脈×5件"),
  status.replace("、絕世地脈×2件", "、未知扣款"),
])("合併套裝不接受重複列、未知結構與尾文：%s", (text) => {
  expect(
    ledgerFact(parseLedgerFacts(message(1, text), Date.now()), "status"),
  ).toBeNull();
});

test("兩份休息回覆不能任選一份，其他指令也不能綁休息", async () => {
  const h = setup();
  await h.act("/status", status);
  const duplicated = await h.act("/rest", [rest, rest]);
  expect(duplicated.accounting?.state).toBe("unresolved");
  expect(duplicated.accounting?.mpAfter).toBeNull();
  await h.act("/status", status);
  const unrelated = await h.act("/look", rest);
  expect(unrelated.accounting?.state).toBe("unresolved");
  expect(unrelated.accounting?.mpAfter).toBeNull();
});

test("切角缺少新status時，休息不能歸屬原角", async () => {
  const h = setup();
  await h.act("/status", status);
  await h.act("/char", "✅ 已切換為其他角色");
  const result = await h.act("/rest", rest);
  expect(result.accounting?.mpAfter).toBeNull();
  expect(h.projection().account).toBeNull();
});

test("收刀未知尾文不視為成功", async () => {
  const h = setup();
  await h.act("/status", status);
  const result = await h.act("/flee", "💨 你趁亂逃跑了！\n受到999傷害");
  expect(result.accounting?.state).toBe("unresolved");
});
