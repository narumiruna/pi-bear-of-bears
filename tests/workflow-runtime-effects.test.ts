import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { runtimeEffectFacts } from "../src/workflow-parsers.js";
import {
  message,
  NOW,
  statusText,
  workflowHarness,
} from "./fixtures/workflow.js";

beforeEach(() => vi.spyOn(Date, "now").mockReturnValue(NOW));
afterEach(() => vi.restoreAllMocks());
const native = (
  JSON.parse(
    readFileSync(
      new URL("./fixtures/native-combat.json", import.meta.url),
      "utf8",
    ),
  ) as { text: string }[]
).find((entry) => entry.text.startsWith("✨ 使用技能：蛟鱗護體·神"))?.text;
if (!native) {
  throw new Error("既有 native fixture 缺少護體回覆");
}

test("綁定同技能的完整原生回覆可讀，保留原來源時間而不恢復舊資源資格", () => {
  const app = workflowHarness();
  app.seed();
  const reply = app.observe(native, "/skill 蛟鱗護體·神");
  const effect = app.store.runtimeEffects();
  expect(effect).toMatchObject({
    effects: [{ kind: "damage_reduction", remainingHits: 3, value: 19 }],
    source: { messageId: reply.id, revision: reply.revision, observedAt: NOW },
  });
  expect(app.store.status()).toBeUndefined();
  vi.mocked(Date.now).mockReturnValue(NOW + 1000);
  app.observe(statusText(), "/status");
  expect(app.store.runtimeEffects()).toEqual(effect);
  expect(app.sent).toEqual([]);
});

test("完整原生效果的 CRLF 不改變逐行解析與技能綁定", () => {
  const app = workflowHarness();
  app.seed();
  app.observe(native.replaceAll("\n", "\r\n"), "/skill 蛟鱗護體·神");
  expect(app.store.runtimeEffects()?.effects).toMatchObject([
    { value: 19, remainingHits: 3 },
  ]);
});

for (const mode of ["wrong_skill", "unbound", "unknown_tail"] as const) {
  test(`原生效果的整份格式及 request 都必須吻合：${mode}`, () => {
    const app = workflowHarness();
    app.seed();
    const text =
      mode === "unknown_tail" ? `${native}\n未知世界結算尾行` : native;
    app.observe(
      text,
      mode === "unbound"
        ? undefined
        : mode === "wrong_skill"
          ? "/skill 合成護盾"
          : "/skill 蛟鱗護體·神",
    );
    expect(app.store.runtimeEffects()).toBeNull();
    expect(app.store.status()).toBeUndefined();
    expect(app.store.invalidationEvent()?.kind).toBe("unknown_bot_reply");
    expect(app.sent).toEqual([]);
  });
}

test.each([false, true])(
  "同批角色改變／首次才出現身分，不能沿用舊 request 綁定效果：%s",
  (seed) => {
    const app = workflowHarness();
    if (seed) {
      app.seed();
    }
    const id = seed ? 100 : 1;
    app.store.observe(
      [message(id, statusText("乙熊")), message(id + 1, native)],
      "/skill 蛟鱗護體·神",
    );
    expect(app.store.runtimeEffects()).toBeNull();
    expect(app.store.status()).toBeUndefined();
    expect(app.store.all().at(-1)?.actor).toBeNull();
  },
);

test.each([
  "接下來3次受擊減傷101%\nDOT：100",
  "易傷999999999999999999999%\nDOT：100",
  "接下來3次受擊減傷18%\n未知額外成本",
])("一行有效不代表整份標籤式效果回覆完整：%s", (text) => {
  expect(runtimeEffectFacts(text)).toBeDefined(); // 局部解析能力保留給研究。
  const app = workflowHarness();
  app.seed();
  app.observe(text, "/skill 合成護盾");
  expect(app.store.runtimeEffects()).toBeNull();
});

test("既有標籤式完整效果回覆仍可解析，技能清單不是已施放效果", () => {
  const app = workflowHarness();
  app.seed();
  app.observe("接下來3次受擊減傷18%\n易傷25%\nDOT：100", "/skill 合成護盾");
  expect(app.store.runtimeEffects()?.effects).toHaveLength(3);
  app.observe(statusText(), "/status");
  app.observe("技能列表\n合成護盾（12MP）接下來3次受擊減傷18%", "/skills");
  expect(app.store.runtimeEffects()?.effects).toHaveLength(3);
  // 新清單不產生新的 effect source，也不把描述當成本次施放。
  expect(app.store.runtimeEffects()?.source.messageId).toBe(7);
});
