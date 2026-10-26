import { readFileSync } from "node:fs";
import { afterEach, expect, test } from "vitest";
import { ledgerBindings } from "../src/ledger-attribution.js";
import { ledgerFact, parseLedgerFacts } from "../src/ledger-facts.js";
import { ledgerHarness } from "./fixtures/ledger.js";
import { message, skillsText, statusText } from "./fixtures/workflow.js";

// 原生819026；與實際技能施放、成本完整性及戰鬥安全分開驗證。
const native = readFileSync(
  new URL("./fixtures/skills-berserker-819026.txt", import.meta.url),
  "utf8",
).trimEnd();
const open: ReturnType<typeof ledgerHarness>[] = [];
function setup() {
  const h = ledgerHarness();
  open.push(h);
  h.install();
  return h;
}
afterEach(() => {
  for (const h of open.splice(0)) {
    h.close();
  }
});

test.each([native, skillsText])(
  "已解析技能表可綁定唯一 /skills 回執，不冒稱施法或完整資源",
  async (text) => {
    const h = setup();
    await h.act("/status", statusText());
    expect(
      ledgerFact(parseLedgerFacts(message(1, text), Date.now()), "skills"),
    ).not.toBeNull();
    const result = await h.act("/skills", text);
    expect(result.accounting).toMatchObject({
      state: "confirmed",
      confirmedMpCost: null,
      mpAfter: null,
      hpAfter: null,
    });
    const projection = h.projection();
    expect(projection.pending).toEqual([]);
    expect(projection.account?.mpSpent).toBe(0);
    const binding = ledgerBindings(h.runtime.read()).bindings.find(
      (b) => b.command === "/skills",
    );
    expect(binding).toMatchObject({ state: "confirmed", command: "/skills" });
    expect(binding?.reply?.message.text).toBe(text);
  },
);

test.each(["/look", "/skill 血怒亂斬", "/skills 其他"])(
  "其他指令 %s 不能綁定技能表",
  async (command) => {
    const h = setup();
    await h.act("/status", statusText());
    const result = await h.act(command, native);
    expect(result.accounting?.state).toBe("unresolved");
    expect(result.accounting?.confirmedMpCost).toBeNull();
  },
);

test("未知技能查詢引數不落盤，也不能冒充精確 /skills", async () => {
  const h = setup();
  const secret = "private-skills-argument-819026";
  await h.act("/status", statusText());
  const result = await h.act(`/skills ${secret}`, native);
  expect(result.accounting?.state).toBe("unresolved");
  const data = h.runtime.read();
  expect(JSON.stringify(data)).not.toContain(secret);
  const binding = ledgerBindings(data).bindings.at(-1);
  expect(binding).toMatchObject({ command: null, reply: null });
});

test("重複技能表回覆不能任取一份確認", async () => {
  const h = setup();
  await h.act("/status", statusText());
  const result = await h.act("/skills", [native, native]);
  expect(result.accounting?.state).toBe("unresolved");
});

test("沒有本人status時只確認查詢回執，不從職業標題推角色", async () => {
  const h = setup();
  const result = await h.act("/skills", native);
  expect(result.accounting).toMatchObject({
    state: "confirmed",
    mpAfter: null,
    hpAfter: null,
  });
  expect(h.projection().account).toBeNull();
});

test("缺少技能列的回覆不確認", async () => {
  const h = setup();
  await h.act("/status", statusText());
  const result = await h.act(
    "/skills",
    "✨ 狂戰熊 技能（MP：422/422）\n未知格式",
  );
  expect(result.accounting?.state).toBe("unresolved");
});

test("只有watch技能表，不產生成功操作", async () => {
  const h = setup();
  await h.act("/status", statusText());
  const observed = h.add(native);
  h.runtime.watch([observed], 0);
  expect(
    ledgerBindings(h.runtime.read()).bindings.filter(
      (b) => b.command === "/skills",
    ),
  ).toEqual([]);
  expect(h.projection().account?.mpSpent).toBe(0);
});
