import { readFileSync } from "node:fs";
import { afterEach, expect, test, vi } from "vitest";
import { parseCombatEvents } from "../src/combat-events.js";
import { skillsFacts } from "../src/workflow-parsers.js";
import {
  inventoryText,
  NOW,
  statusText,
  workflowHarness,
} from "./fixtures/workflow.js";

// 戰報為實際原文；其前後資源由合成 harness 提供，只驗本機對帳，不是實機安全驗證。
const receipts = JSON.parse(
  readFileSync(
    new URL("./fixtures/native-combat-770282-770320.json", import.meta.url),
    "utf8",
  ),
) as {
  id: number;
  date: number;
  revision: string;
  originalSourceId: string;
  text: string;
}[];
const won = receipts.find((entry) => entry.id === 770320);
if (!won) {
  throw new Error("缺少770320原生回執");
}
const receipt = won;
afterEach(() => vi.restoreAllMocks());

test("770320原生爆追正式回執接入G對帳；缺結算、未知行或錢差不符不閉帳", async () => {
  vi.spyOn(Date, "now").mockReturnValue(NOW);
  for (const [kind, text, delta, credits, confirmed] of [
    ["完整", receipt.text, 4898, 4898, true],
    ["無正式結算", receipt.text.replace(/^💀.*\n/mu, ""), 4898, 0, false],
    ["未知行", `${receipt.text}\n未知追加費用`, 4898, 0, false],
    ["錢差不符", receipt.text, 4897, 4898, false],
  ] as const) {
    const app = workflowHarness();
    const before = app.seed();
    app.observe(text, "/skill 血怒亂斬");
    vi.mocked(Date.now).mockReturnValue(NOW + 1000);
    app.observe(statusText("測試熊", 900, 28, 1000 + delta), "/status");
    app.observe(inventoryText(), "/inventory all");
    const after = app.store.capture();
    const result = await app.call("bears_reconcile_rewards", {
      before: before.id,
      after: after.id,
    });
    expect(result.state, kind).toBe(
      confirmed ? "confirmed" : "needs_observation",
    );
    expect(result.data.credits, kind).toBe(credits);
    expect(app.sent, kind).toEqual([]);
    vi.mocked(Date.now).mockReturnValue(NOW);
  }
});

test("完整戰報仍不填首次王血／名吸實補或提升riskVerified", () => {
  const parsed = parseCombatEvents(receipt.text, {
    messageId: receipt.id,
    date: receipt.date,
    revision: receipt.revision,
    originalSourceId: receipt.originalSourceId,
    observedAt: receipt.date * 1000,
  });
  expect(parsed).toMatchObject({
    complete: true,
    outcome: "won",
    riskVerified: false,
  });
  expect(
    parsed.events.find((event) => event.kind === "damage")?.actual,
  ).toEqual({ value: null, basis: "unknown" });
  expect(
    parsed.events.find((event) => event.kind === "healing")?.actual,
  ).toEqual({ value: null, basis: "unknown" });
  expect(parsed.events.some((event) => event.actual?.value === 21245)).toBe(
    false,
  );
});

test("戰報解析成功不讓770278原生技能節錄取得未知成本的零值", () => {
  const skills = skillsFacts(
    "✨ 狂戰熊 技能（MP：422/422）\n  /skill 血怒亂斬　MP:32　期望 19,600\n　　連續 5 段爪擊（每段 100% 攻擊力），吸取 35% 傷害回血",
  );
  expect(skills).toMatchObject([
    {
      name: "血怒亂斬",
      mpCost: 32,
      expectedDamage: 19600,
      hpCost: null,
      costsComplete: false,
    },
  ]);
});
