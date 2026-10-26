import { readFileSync } from "node:fs";
import type {
  ExtensionAPI,
  ExtensionToolContext,
} from "@earendil-works/pi-coding-agent";
import { afterEach, expect, test, vi } from "vitest";
import { gameToolResult } from "../src/bears-result.js";
import { parseCombatEvents } from "../src/combat-events.js";
import { registerGameCommandTools } from "../src/game-commands.js";
import { ledgerBindings } from "../src/ledger-attribution.js";
import { ledgerOriginal, ledgerWatch } from "../src/ledger-channel.js";
import { ledgerFact, parseLedgerFacts } from "../src/ledger-facts.js";
import { projectLedger } from "../src/ledger-projection.js";
import { ledgerToolAPI } from "../src/ledger-tool-api.js";
import { ledgerHarness, skillText } from "./fixtures/ledger.js";
import { message, statusText } from "./fixtures/workflow.js";

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
  vi.restoreAllMocks();
});

test("共同 Game 接點逐手記帳；send/history/watch 重複只扣一次且綁原文", async () => {
  const h = setup();
  h.seed();
  const result = await h.act("/skill 血怒亂斬");
  expect(result.accounting).toMatchObject({
    state: "confirmed",
    confirmedMpCost: 32,
    mpAfter: 68,
    hpAfter: 500,
    operationalEligibility: false,
  });
  const source = "abcddcba-0000-4000-8000-000000000001";
  ledgerWatch(h.messages);
  ledgerOriginal(h.messages, source);
  await h.game.history();
  await h.game.history();
  expect(h.projection().account).toMatchObject({
    character: "測試熊",
    mpSpent: 32,
    mp: { value: 68 },
    hp: { value: 500 },
  });
  const trace = h.store.trace(h.runtime.read().observations.at(-1)?.id ?? 0);
  expect(trace?.originalSourceId).toBe(source);
  expect(
    ledgerBindings(h.runtime.read()).bindings.filter(
      (b) => b.state === "confirmed",
    ),
  ).toHaveLength(3);
  expect(h.bot.send).toHaveBeenCalledOnce();
  const output = await gameToolResult(result);
  expect(output.structuredContent).toMatchObject({
    accounting: { confirmedMpCost: 32, mpAfter: 68 },
  });
});

test("不同 ID 的相同回覆仍是兩筆；不用文字 hash 合併成本", async () => {
  const h = setup();
  h.seed();
  await h.act("/skill 血怒亂斬");
  await h.act("/skill 血怒亂斬");
  expect(h.projection().account).toMatchObject({
    mpSpent: 64,
    mp: { value: 36 },
  });
  expect(
    h.runtime.read().observations.filter((o) => o.message.text === skillText()),
  ).toHaveLength(2);
});

test("空回覆後讀 history 補證，不重送；watch 先到不能憑時間綁定", async () => {
  const h = setup();
  h.seed();
  const result = await h.act("/skill 血怒亂斬", []);
  expect(result.accounting).toMatchObject({
    state: "unresolved",
    mpAfter: null,
  });
  expect(h.projection("測試熊").account?.mp.value).toBeNull();
  const late = h.add(skillText());
  ledgerWatch([late]);
  await h.game.history();
  expect(h.projection().account).toMatchObject({
    mpSpent: 32,
    mp: { value: 68 },
  });
  expect(h.bot.send).toHaveBeenCalledOnce();
});

test("沒有 outgoing echo 的 watch 回覆保留原文，不扣本人 MP", () => {
  const h = setup();
  h.seed();
  const m = h.add(skillText());
  ledgerWatch([m]);
  expect(h.projection().account).toMatchObject({
    mpSpent: 0,
    mp: { value: null },
  });
  expect(h.projection().gaps.some((g) => g.reason.includes("未歸屬"))).toBe(
    true,
  );
});

test.each(["MP 不足！需要 32 MP，目前 22 MP。", "未知拒絕格式"])(
  "拒絕不冒充成功：%s",
  async (text) => {
    const h = setup();
    h.seed("測試熊", 22);
    const result = await h.act("/skill 血怒亂斬", text);
    expect(h.projection("測試熊").account?.mpSpent).toBe(0);
    expect(result.accounting?.state).toBe(
      text.startsWith("MP") ? "rejected" : "unresolved",
    );
    expect(result.accounting?.confirmedMpCost).toBeNull();
  },
);

test("未知尾文保留獨立標頭成本，但不推餘額或放寬共用 complete", async () => {
  const h = setup();
  h.seed();
  const result = await h.act(
    "/skill 血怒亂斬",
    skillText(32, "\n未知特殊追傷"),
  );
  expect(result.accounting).toMatchObject({
    confirmedMpCost: 32,
    mpAfter: null,
    hpAfter: null,
    complete: false,
  });
  expect(h.projection().account?.mpSpent).toBe(32);
  const facts = parseLedgerFacts(
    h.messages.at(-1) ?? message(1, ""),
    Date.now(),
  );
  expect(ledgerFact<{ complete: boolean }>(facts, "combat")?.complete).toBe(
    false,
  );
});

test("未知起點可以確認成本，不能猜 MP；新 status 保留差額而不硬閉帳", async () => {
  const h = setup();
  const result = await h.act("/skill 血怒亂斬");
  expect(result.accounting).toMatchObject({
    confirmedMpCost: 32,
    mpAfter: null,
  });
  expect(h.projection().account).toBeNull();
  h.seed();
  await h.act("/skill 血怒亂斬");
  await h.act("/status", statusText("測試熊", 500, 67));
  expect(h.projection().account?.reconciliations).toContainEqual(
    expect.objectContaining({
      field: "mp",
      expected: 68,
      observed: 67,
      difference: -1,
    }),
  );
});

test("主動／裝備恢復與溢補分開；保留先機→恢復→反擊時序", () => {
  const parsed = parseCombatEvents(skillText(), {
    messageId: 1,
    revision: "a",
    date: 1,
    observedAt: 1000,
  });
  expect(parsed.complete).toBe(true);
  expect(parsed.events.filter((e) => e.kind === "healing")).toMatchObject([
    {
      healingSource: "mythic_lifesteal",
      nominal: { value: 300 },
      actual: { value: 300 },
      overheal: { value: 0 },
    },
    {
      healingSource: "active_skill",
      nominal: { value: 600 },
      actual: { value: 200 },
      unappliedNominal: { value: 400 },
      overheal: { value: null },
    },
  ]);
  expect(parsed.events.map((e) => e.kind)).toEqual([
    "mp_cost",
    "initiative_marker",
    "initiative",
    "damage",
    "healing",
    "healing",
    "counter",
  ]);
  expect(parsed.riskVerified).toBe(false);
});

test("原生 fixtures 的已包含真傷不重加；首次治療實補仍 unknown", () => {
  const fixture = JSON.parse(
    readFileSync(
      new URL("./fixtures/native-combat.json", import.meta.url),
      "utf8",
    ),
  )[0] as { text: string };
  const parsed = parseCombatEvents(fixture.text, {
    messageId: 1,
    revision: "a",
    date: 1,
    observedAt: 1000,
  });
  expect(parsed.events.find((e) => e.kind === "healing")).toMatchObject({
    healingSource: "active_skill",
    actual: { value: null },
    overheal: { value: null },
  });
  expect(parsed.events.find((e) => e.kind === "included_damage")).toMatchObject(
    { actual: { value: null } },
  );
});

test("其他角色自然掛機獨立入帳，不切角、不併本人塔金", async () => {
  const h = setup();
  h.seed();
  await h.act("/skill 血怒亂斬", [
    "【其他熊】\n🐾 已掛機 1 小時（本次結算 1 小時）\nEXP +100　🪙 +123",
    skillText(),
  ]);
  expect(h.projection().account).toMatchObject({
    credits: 0,
    gold: { value: 1000 },
    mpSpent: 32,
  });
  expect(h.projection("其他熊").account?.credits).toBe(123);
});

test("通層 replay 的怪金／首達／合計只計一次並保留實際錢差", async () => {
  const h = setup();
  h.seed();
  const won =
    "✨ 使用技能：血怒亂斬（MP -32）\n造成 100 點傷害！🐻 HP：0/100\n💀 合成星影 倒下！EXP +100  金幣 +5";
  await h.act("/skill 血怒亂斬", [
    won,
    "通層回執：第92層\n怪金：5G\n首達：100G\n合計：105G",
  ]);
  await h.game.history();
  expect(h.projection().account).toMatchObject({
    credits: 105,
    repeatable: 5,
    firstClear: 100,
    gold: { value: 1105 },
  });
  await h.act("/status", statusText("測試熊", 1000, 68, 1104));
  expect(h.projection().account?.reconciliations).toContainEqual(
    expect.objectContaining({ field: "gold", difference: -1 }),
  );
});

test("revision 更正保留兩版，重讀舊版不勝出；缺口只失效相依事實", async () => {
  const h = setup();
  h.seed();
  await h.act("/skill 血怒亂斬");
  const old = h.messages.at(-1);
  if (!old) {
    throw new Error("缺回執");
  }
  const updated = { ...old, revision: "b".repeat(64), text: skillText(33) };
  ledgerWatch([updated]);
  ledgerWatch([old]);
  expect(h.projection().conflicts).toEqual([old.id]);
  expect(h.projection("測試熊").account?.mpSpent).toBe(0);
  expect(
    h.runtime.read().observations.filter((o) => o.message.id === old.id),
  ).toHaveLength(2);
  await h.act("/status", statusText("測試熊", 1000, 67));
  expect(h.projection().account?.mp.value).toBe(67);
});

test("分支回復不撤銷遊戲；新外部事件使推導失效，reload 不送出", async () => {
  const h = setup();
  h.seed();
  const branch = h.references();
  await h.act("/skill 血怒亂斬");
  const all = h.references();
  h.branch(branch);
  expect(h.projection()).toMatchObject({
    externalEvents: expect.any(Number),
    operationalEligibility: false,
  });
  expect(h.projection("測試熊").account?.mp.value).toBeNull();
  expect(h.projection().activeCharacter).toBeNull();
  h.branch(all);
  expect(h.projection().account?.mp.value).toBe(68);
  h.store.reparse();
  expect(projectLedger(h.store.read(all))).toEqual(h.projection());
  expect(h.bot.send).toHaveBeenCalledOnce();
});

test("切角與未知全服公告不承接舊資源，成本不混本人帳", async () => {
  const h = setup();
  h.seed();
  await h.act("/char 2", "已切角");
  await h.act("/skill 血怒亂斬");
  expect(h.projection().character).toBeNull();
  expect(h.projection("測試熊").account?.mpSpent).toBe(0);
  h.seed("別隻熊");
  ledgerWatch([h.add("全服未知公告／獎勵")]);
  expect(h.projection().account?.mp.value).toBeNull();
});

test("watch 缺頁、未來日期與時鐘倒退不猜餘額", () => {
  const h = setup();
  h.seed();
  ledgerWatch([], 5);
  expect(h.projection("測試熊").account?.mp.value).toBeNull();
  const future = {
    ...h.add(statusText()),
    date: Math.floor(Date.now() / 1000) + 10,
  };
  ledgerWatch([future]);
  expect(h.projection().account?.mp.value).toBeNull();
  expect(h.projection().gaps.some((g) => g.reason.includes("時鐘"))).toBe(true);
});

test.each(["text", "callback"] as const)(
  "Game click %s 接點記錄；只有已驗文字按鈕可關聯技能成本",
  async (kind) => {
    const h = setup();
    const menu = h.add("選單");
    menu.buttons.push({ row: 0, column: 0, text: "/skill 血怒亂斬", kind });
    h.seed();
    vi.mocked(h.bot.click).mockImplementationOnce(() => {
      h.add("/skill 血怒亂斬", true);
      h.add(skillText());
      return Promise.resolve("OK");
    });
    const result = await h.game.act({
      messageId: menu.id,
      revision: menu.revision,
      row: 0,
      column: 0,
    });
    expect(result.accounting?.confirmedMpCost).toBe(
      kind === "text" ? 32 : null,
    );
    expect(h.bot.click).toHaveBeenCalledOnce();
    expect(h.bot.send).not.toHaveBeenCalled();
  },
);
test("structured tool 及 workflow 類型的共用 Game 保留真實 call ID，不靠外層 tool_result", async () => {
  const h = setup();
  h.seed();
  const tools = new Map<string, Parameters<ExtensionAPI["registerTool"]>[0]>();
  const api = ledgerToolAPI({
    registerTool: (tool: Parameters<ExtensionAPI["registerTool"]>[0]) =>
      tools.set(tool.name, tool),
  } as unknown as ExtensionAPI);
  registerGameCommandTools(api, async (text, signal) => {
    vi.mocked(h.bot.send).mockImplementationOnce(() => {
      h.add(text, true);
      h.add(skillText());
      return Promise.resolve();
    });
    return gameToolResult(await h.game.act({ text }, signal));
  });
  const skill = tools.get("bears_skill");
  if (!skill) {
    throw new Error("缺 tool");
  }
  await skill.execute(
    "outer/nested/1",
    { name: "血怒亂斬" },
    undefined,
    undefined,
    {} as ExtensionToolContext,
  );
  expect(
    h.runtime
      .read()
      .contexts.some(
        (c) =>
          c.toolCallId === "outer/nested/1" && c.toolName === "bears_skill",
      ),
  ).toBe(true);
  expect(h.projection().account?.mpSpent).toBe(32);
});
test("私人自由文字／聊天引數不進永久帳本，原文 hash 與必要技能證據仍保留", async () => {
  const h = setup();
  h.seed();
  await h.act("/say 私人聊天 secret-123", []);
  await h.act("private-password-456", []);
  const data = JSON.stringify(h.runtime.read());
  expect(data).not.toContain("secret-123");
  expect(data).not.toContain("password-456");
  expect(data).toContain("未保存非記帳指令文字");
});
test("回覆頁與送出前頁無交集時失效相依資源，不猜隱藏頁的角色或餘額", async () => {
  const h = setup();
  h.seed();
  await h.act("/skill 血怒亂斬", [
    ...Array.from({ length: 12 }, () => "未知公告"),
    skillText(),
  ]);
  expect(h.projection("測試熊").account?.mp.value).toBeNull();
  expect(h.projection().activeCharacter).toBeNull();
  expect(h.runtime.read().events.some((e) => e.kind === "gap")).toBe(true);
});

test("同一 outgoing 後兩筆相符回執不唯一時不選第一／最後一筆猜成功", async () => {
  const h = setup();
  h.seed();
  const result = await h.act("/skill 血怒亂斬", [skillText(), skillText()]);
  expect(result.accounting).toMatchObject({
    state: "unresolved",
    confirmedMpCost: null,
    mpAfter: null,
  });
  expect(h.projection("測試熊").account?.mpSpent).toBe(0);
  expect(h.bot.send).toHaveBeenCalledOnce();
});
