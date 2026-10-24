import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { NOW, statusText, workflowHarness } from "./fixtures/workflow.js";

beforeEach(() => vi.spyOn(Date, "now").mockReturnValue(NOW));
afterEach(() => vi.restoreAllMocks());
async function cooldown(app: ReturnType<typeof workflowHarness>) {
  const result = await app.call("bears_combat_snapshot", {
    mode: "boss",
    includeHistory: true,
  });
  return (result.data.history as { personalCooldown: Record<string, unknown> })
    .personalCooldown;
}
const victory = "戰鬥紀錄：同名王\n結算：勝利\n獲得金幣：10G";

test("同名王的兩角勝場分列，不按名稱合併限制或資格", async () => {
  const app = workflowHarness();
  app.seed();
  const first = app.observe(victory, "/skill 合成招");
  app.observe(statusText("乙熊"), "/status");
  const second = app.observe(victory, "/skill 合成招");
  const result = await cooldown(app);
  expect(result).toMatchObject({
    eligible: null,
    characters: [
      {
        character: "乙熊",
        eligible: null,
        restrictionConfirmed: false,
        expiresAt: null,
        knownWins: [
          {
            source: { messageId: second.id },
            target: { name: "同名王", type: "unknown" },
          },
        ],
      },
      {
        character: "測試熊",
        eligible: null,
        restrictionConfirmed: false,
        expiresAt: null,
        knownWins: [
          {
            source: { messageId: first.id },
            target: { name: "同名王", type: "unknown" },
          },
        ],
      },
    ],
  });
  expect(app.sent).toEqual([]);
});

test("公共存活與經過兩小時不會清除勝場或將未知規則推算為資格", async () => {
  const app = workflowHarness();
  app.seed();
  const win = app.observe(victory, "/skill 合成招");
  const source = structuredClone(
    app.store.all().find((entry) => entry.message.id === win.id)?.source,
  );
  vi.mocked(Date.now).mockReturnValue(NOW + 7200000);
  app.observe("公開世界王已重新現身；不是私人資格證據");
  app.observe(statusText(), "/status");
  expect(await cooldown(app)).toMatchObject({
    characters: [{ eligible: null, expiresAt: null, knownWins: [{ source }] }],
  });
  expect(app.sent).toEqual([]);
});

test("原生／限制關鍵字只列未驗證來源，不冒稱已辨識私人冷卻", async () => {
  const app = workflowHarness();
  app.seed();
  const idle = app.observe("【測試熊】\n🐾 掛機 1 小時，金幣 +100G");
  const report = app.observe("未知格式的討伐限制回覆", "/skill 合成招");
  expect(await cooldown(app)).toMatchObject({
    characters: [
      {
        character: "測試熊",
        eligible: null,
        restrictionConfirmed: false,
        unverifiedSources: [
          { source: { messageId: idle.id } },
          { source: { messageId: report.id } },
        ],
      },
    ],
  });
  expect(app.sent).toEqual([]);
});

test("未確認切角的勝報不掛任何角色；修訂及 reset 不留舊勝證據", async () => {
  const app = workflowHarness();
  app.seed();
  const win = app.observe(victory, "/skill 合成招");
  app.store.observe(
    [{ ...win, revision: "escaped", text: "戰鬥紀錄：同名王\n結算：逃離" }],
    "/flee",
  );
  app.observe("/switch 乙熊", undefined, true);
  const unknown = app.observe(victory, "/skill 合成招");
  expect(await cooldown(app)).toMatchObject({
    characters: [{ knownWins: [], eligible: null }],
    unboundSources: [{ source: { messageId: unknown.id } }],
  });
  app.store.reset();
  expect(await cooldown(app)).toMatchObject({
    characters: [],
    unboundSources: [],
    eligible: null,
  });
  expect(app.sent).toEqual([]);
});

test("勝場證據有界，展示省略與規則未確認分開，不以省略當無限制", async () => {
  const app = workflowHarness();
  app.seed();
  for (let i = 0; i < 26; i++) {
    app.observe(victory, "/skill 合成招");
  }
  const result = await cooldown(app);
  expect(result).toMatchObject({
    characters: [
      { omittedWins: 6, eligible: null, restrictionConfirmed: false },
    ],
  });
  expect(
    (result.characters as { knownWins: unknown[] }[])[0].knownWins,
  ).toHaveLength(20);
  expect(app.sent).toEqual([]);
});
