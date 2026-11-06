import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { towerShieldBudget } from "../src/tower-shield-budget.js";
import type { towerFacts } from "../src/workflow-parsers.js";
import {
  NOW,
  statusText,
  towerText,
  workflowHarness,
} from "./fixtures/workflow.js";

const spring =
  "✨ 使用技能：地脈·萬物回春（MP -60）\n💚 恢復 550 HP！HP：1000/1000\n🛡️ 地脈之盾！接下來 3 次受擊減傷 24%";
beforeEach(() => vi.spyOn(Date, "now").mockReturnValue(NOW));
afterEach(() => vi.restoreAllMocks());

test("原生 outgoing 比回覆早一秒時，合成時鐘可重現請求先過期", () => {
  const fixture: {
    actor: string;
    spring: {
      messages: Omit<
        Parameters<typeof towerShieldBudget>[0][number]["message"],
        "buttons"
      >[];
      boundSources: Parameters<typeof towerShieldBudget>[0][number]["source"][];
    };
    failure: {
      planner: {
        data: { encounter: NonNullable<ReturnType<typeof towerFacts>> };
      };
    };
  } = JSON.parse(
    readFileSync(
      new URL(
        "./fixtures/native-tower-shield-request-freshness-2026-11-06.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const records = fixture.spring.messages.map((message) => {
    const source = fixture.spring.boundSources.find(
      (entry) => entry.messageId === message.id,
    );
    if (!source) {
      throw new Error("缺少原生來源");
    }
    return {
      message: { ...message, buttons: [] },
      source,
      actor: fixture.actor,
      command: "/skill 地脈·萬物回春",
      epoch: 0,
      coverage: 0,
      revised: false,
    };
  });
  const outgoing = records.find((record) => record.message.outgoing);
  if (!outgoing) {
    throw new Error("缺少 outgoing");
  }
  // 只合成時鐘與控制情境；不補造原始呼叫時間或內部 epoch。
  const result = towerShieldBudget(
    records,
    fixture.actor,
    0,
    fixture.failure.planner.data.encounter,
    outgoing.source.date * 1000 + 60_001,
  );
  expect(result).toMatchObject({
    min: null,
    sources: [],
    issues: ["回春的 outgoing 已超過 60 秒；不沿用其護盾預算。"],
    unavailableReason: "回春的 outgoing 已超過 60 秒；不沿用其護盾預算。",
  });
});

test("自然再現的呼叫界限均確認 outgoing 過期而回覆仍新鮮", () => {
  const fixture: {
    clockBoundsMs: { before: number; after: number };
    spring: {
      originalSourceId: string;
      messages: {
        id: number;
        text: string;
        outgoing: boolean;
        revision: string;
        date: number;
        observedAt: number;
      }[];
    };
    failedPlan: {
      state: string;
      actor: string;
      blockers: string[];
      data: {
        encounter: NonNullable<ReturnType<typeof towerFacts>>;
        shieldBudget: ReturnType<typeof towerShieldBudget>;
      };
    };
  } = JSON.parse(
    readFileSync(
      new URL(
        "./fixtures/native-tower-outgoing-expired-2026-11-06.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const records = fixture.spring.messages.map((message) => ({
    message: { ...message, buttons: [], hasMedia: false },
    source: {
      messageId: message.id,
      revision: message.revision,
      date: message.date,
      observedAt: message.observedAt,
      originalSourceId: fixture.spring.originalSourceId,
    },
    actor: fixture.failedPlan.actor,
    command: "/skill 地脈·萬物回春",
    epoch: 0,
    coverage: 0,
    revised: false,
  }));
  const request = records.find((record) => record.message.outgoing);
  const reply = records.find((record) => !record.message.outgoing);
  if (!request || !reply) {
    throw new Error("缺少原生請求或回覆");
  }
  expect(fixture.failedPlan.state).toBe("needs_observation");
  expect(fixture.clockBoundsMs.before).toBeLessThanOrEqual(
    fixture.clockBoundsMs.after,
  );
  for (const now of Object.values(fixture.clockBoundsMs)) {
    expect(now - request.source.date * 1000).toBeGreaterThan(60_000);
    expect(now - reply.source.date * 1000).toBeLessThanOrEqual(60_000);
    // 控制情境合成；時鐘界限、訊息與 observedAt 均取自本次實機。
    const budget = towerShieldBudget(
      records,
      fixture.failedPlan.actor,
      0,
      fixture.failedPlan.data.encounter,
      now,
    );
    expect(budget).toMatchObject({
      min: null,
      sources: [],
      issues: fixture.failedPlan.blockers,
      unavailableReason: fixture.failedPlan.data.shieldBudget.unavailableReason,
    });
  }
});

test.each([60_000, 60_001, 61_000, 61_001])(
  "outgoing 年齡 %i ms 與晚一秒回覆的時效各自核驗",
  async (age) => {
    const app = workflowHarness();
    app.state.hp = 1000;
    app.state.mp = 82;
    app.seed();
    app.observe("/skill 地脈·萬物回春", undefined, true);
    vi.mocked(Date.now).mockReturnValue(NOW + 1000);
    app.observe(spring, "/skill 地脈·萬物回春");
    vi.mocked(Date.now).mockReturnValue(NOW + age);
    app.observe(statusText(app.state.name, 1000, 22), "/status");
    app.observe(towerText(), "/tower");
    const snapshot = await app.call("bears_combat_snapshot", {
      mode: "tower",
      view: "summary",
    });
    const result = await app.call("bears_plan_tower_step", {
      snapshotId: snapshot.data.snapshotId,
      policy: "blood-earth-32-60",
    });
    const requestOnlyExpired = age > 60_000 && age <= 61_000;
    expect(result.state).toBe(
      requestOnlyExpired ? "needs_observation" : "ready",
    );
    expect(result.data.shieldBudget).toMatchObject({
      min: age === 60_000 ? 3 : null,
    });
    if (requestOnlyExpired) {
      expect(result.blockers).toEqual([
        "回春的 outgoing 已超過 60 秒；不沿用其護盾預算。",
      ]);
      expect(result.data.shieldBudget).toMatchObject({
        unavailableReason: result.blockers[0],
      });
      expect(result.data.recommendation).toBeUndefined();
    } else {
      expect(result.data.decision).toBe("recover");
      expect(result.data.shieldBudget).toMatchObject({
        unavailableReason: null,
      });
    }
    expect(app.sent).toEqual([]);
    expect(app.context.executeTool).not.toHaveBeenCalled();
  },
);
