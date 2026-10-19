import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { upgradeQuote } from "../src/upgrade-quote.js";
import {
  inventoryText,
  NOW,
  statusText,
  workflowHarness,
} from "./fixtures/workflow.js";

const fixtures = JSON.parse(
  readFileSync(
    new URL("./fixtures/native-forge.json", import.meta.url),
    "utf8",
  ),
) as {
  id: number;
  date: number;
  revision: string;
  originalSourceId: string;
  text: string;
}[];
const fixture = (id: number) => {
  const row = fixtures.find((row) => row.id === id);
  if (!row) {
    throw new Error("缺少原生原文");
  }
  return row;
};
const source = (id: number) => ({
  ...fixture(id),
  messageId: id,
  observedAt: NOW,
});
const options = {
  target: "星核行者之靴·極",
  metric: "attributes",
  weights: { attack: 1, defense: 1, intelligence: 1, agility: 1 },
};
beforeEach(() => vi.spyOn(Date, "now").mockReturnValue(NOW));
afterEach(() => vi.restoreAllMocks());

test("743400 原生免費預覽只列基價150萬與精30，不誤當225萬含稅價或資格", () => {
  const quote = upgradeQuote(fixture(743400).text, "forge", source(743400));
  expect(quote).toMatchObject({
    baseGold: 1500000,
    totalGold: null,
    taxGold: null,
    complete: false,
    automaticEquip: null,
  });
});

test("原生 forge 選單／預覽接入本人候選，保留缺稅及兩軸差，不補其他軸為零", async () => {
  for (const id of [743398, 743400]) {
    const app = workflowHarness();
    app.seed();
    app.observe(
      inventoryText()
        .replace("🟠⚔️傳世鋼鐵巨劍", "🟠⚡星核行者之靴·極")
        .replace("ATK +5（Lv1 可裝備）", "DEF +336 AGI +518（BOSS 進階）"),
      "/inventory all",
    );
    app.observe(
      fixture(id).text,
      id === 743398 ? "/forge" : "/forge preview 4",
    );
    const result = await app.call("bears_plan_upgrade", options);
    const candidate = (result.data.candidates as Record<string, unknown>[])[0];
    expect(candidate).toMatchObject({
      quotedGold: 1500000,
      totalGold: null,
      canPay: false,
      stage: "·極 → ·神",
      materials: [{ name: "王之精魄", quantity: 30, held: 5, missing: 25 }],
    });
    if (id === 743400) {
      expect(candidate.comparison).toMatchObject({
        axisDelta: {
          attack: null,
          defense: 108,
          intelligence: null,
          agility: 166,
        },
      });
    }
    expect(app.sent).toEqual([]);
  }
});

test.each([
  "需 💠×30（你有 ×5048）＋ 1,500,00G（你有 25,705,493G）",
  "需 💠×30（你有 ×5048）＋ 1,500,000G（你有 25,705,493G）另收稅",
])("原生預覽非法金額或未識別尾註不當已核基價：%s", (cost) => {
  const raw = fixture(743400).text.replace(/^　需.*$/mu, cost);
  expect(upgradeQuote(raw, "forge", source(743400))).toMatchObject({
    baseGold: null,
    complete: false,
    totalGold: null,
  });
});

test("原生預覽不可將神→神·極當作 base→極，屬性重複也不給已核基價", () => {
  for (const raw of [
    fixture(743400).text.replace(
      "⚡星核行者之靴·極 → ⚡星核行者之靴·神",
      "⚡星核行者之靴·神 → ⚡星核行者之靴·神·極",
    ),
    `${fixture(743400).text}\nDEF 336→444（+108）`,
  ]) {
    expect(upgradeQuote(raw, "forge", source(743400))).toMatchObject({
      baseGold: null,
      totalGold: null,
      complete: false,
    });
  }
});

test("743402 原生消耗回執計入明列基價＋稅，精魄、成品或費用差不符即不閉帳", async () => {
  for (const kind of ["known", "gold", "essence", "extra", "outcome"]) {
    const app = workflowHarness();
    app.state.gold = 3000000;
    app.seed();
    app.observe(
      inventoryText()
        .replace("王之精魄 x5", "王之精魄 x35")
        .replace("傳世鋼鐵巨劍", "星核行者之靴·極"),
      "/inventory all",
    );
    const before = app.store.capture();
    app.observe(
      `${fixture(743402).text}${kind === "extra" ? "\n另收手續費：100G" : ""}`,
      "/forge 4",
    );
    vi.mocked(Date.now).mockReturnValue(NOW + 1000);
    app.observe(
      statusText("測試熊", 900, 60, kind === "gold" ? 749900 : 750000),
      "/status",
    );
    app.observe(
      inventoryText()
        .replace(
          "王之精魄 x5",
          kind === "essence" ? "王之精魄 x6" : "王之精魄 x5",
        )
        .replace(
          "傳世鋼鐵巨劍",
          kind === "outcome" ? "星核行者之靴·極" : "星核行者之靴·神",
        ),
      "/inventory all",
    );
    const after = app.store.capture();
    const result = await app.call("bears_reconcile_rewards", {
      before: before.id,
      after: after.id,
    });
    expect(result.state).toBe(
      kind === "known" ? "confirmed" : "needs_observation",
    );
    if (kind === "known") {
      expect(result.data.debits).toBe(2250000);
    }
    expect(app.sent).toEqual([]);
    vi.mocked(Date.now).mockReturnValue(NOW);
  }
});
