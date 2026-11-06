import { Check } from "typebox/value";
import { afterEach, expect, test, vi } from "vitest";
import {
  BEARS_RESULT_SCHEMA,
  gameFailureResult,
  gameToolResult,
} from "../src/bears-result.js";
import {
  currentDispatchCheck,
  withDispatchCheck,
} from "../src/game-operation.js";
import { BLOOD_SKILL, EARTH_SKILL } from "../src/tower-shield-budget.js";
import { planTowerStep } from "../src/workflow-tower-step.js";
import {
  args,
  invoke,
  native,
  receipt,
  rejected,
  setup,
} from "./fixtures/tower-skill-dispatch.js";
import { message, statusText } from "./fixtures/workflow.js";

afterEach(() => vi.restoreAllMocks());

test("未掛 guard 的舊普通 skill 控制：規劃後塔錨達63秒仍 send1", async () => {
  const h = setup();
  expect(planTowerStep(h.app.store, h.snapshotId)).toMatchObject({
    state: "ready",
    data: { decision: "blood", shieldBudget: { min: 2 } },
  });
  h.clock.mockReturnValue(native.blood.outgoing.date * 1000);
  await h.app.tools
    .get("bears_skill")
    ?.execute(
      "red",
      { name: BLOOD_SKILL },
      undefined,
      undefined,
      h.app.context,
    );
  expect(h.wireSend).toHaveBeenCalledTimes(1);
  expect(h.wireSend).toHaveBeenCalledWith(
    `/skill ${BLOOD_SKILL}`,
    expect.any(AbortSignal),
  );
  expect(currentDispatchCheck()).toBeUndefined();
});

test("獨立 tool 的 codemode／receipt metadata 及嚴格 schema", () => {
  const h = setup();
  const tool = h.app.tools.get("bears_tower_skill");
  expect(tool).toMatchObject({
    exposure: "codemode",
    outputSchema: BEARS_RESULT_SCHEMA,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
  });
  if (!tool) {
    throw new Error("缺少 tool");
  }
  expect(tool.parameters).toMatchObject({
    additionalProperties: false,
    required: ["snapshotId", "policy", "name"],
  });
  expect(Check(tool.parameters, args(h))).toBe(true);
  expect(Check(tool.parameters, args(h, EARTH_SKILL))).toBe(true);
  expect(h.app.tools.has("bears_skill")).toBe(true);
  expect(native.prePlan.fullRaw).toBeNull();
  expect(native.anchor.rawText).toBeNull();
  expect(native.spring.rawText).toBeNull();
});

test.each([
  null,
  {},
  { snapshotId: "not-uuid" },
  { policy: "unknown" },
  { name: "合成大招" },
  { scope: {} },
  { riskVerified: true },
])("入口 schema 拒絕 %j，不建立連線", async (patch) => {
  const h = setup();
  const params =
    patch === null
      ? null
      : Object.keys(patch).length === 0
        ? {}
        : { ...args(h), ...patch };
  await rejected(h, params);
  expect(h.send).not.toHaveBeenCalled();
  expect(h.bot.connect).not.toHaveBeenCalled();
});

test.each(["before", "after"] as const)(
  "原生 plan clock %s 仍 ready/blood；入口63秒拒絕而非自動回春",
  async (key) => {
    const h = setup();
    h.clock.mockReturnValue(native.prePlan.clock[key]);
    expect(planTowerStep(h.app.store, h.snapshotId)).toMatchObject({
      state: "ready",
      data: { decision: "blood", shieldBudget: { min: 2 } },
    });
    expect(Date.now() - native.anchor.date * 1000).toBe(
      key === "before" ? 56614 : 56616,
    );
    h.clock.mockReturnValue(native.blood.outgoing.date * 1000);
    await rejected(h);
    expect(h.send).not.toHaveBeenCalled();
    expect(h.bot.history).not.toHaveBeenCalled();
  },
);

test.each(["connect", "before_history"])(
  "%s 延遲越過塔錨60秒時，Game 真實 pre-dispatch hook 拒絕",
  async (phase) => {
    const h = setup();
    const expire = () =>
      h.clock.mockReturnValue(native.blood.outgoing.date * 1000);
    if (phase === "connect") {
      vi.mocked(h.bot.connect).mockImplementationOnce(() => {
        expire();
        return Promise.resolve();
      });
    } else {
      vi.mocked(h.bot.history).mockImplementationOnce(() => {
        expire();
        return Promise.resolve([...h.app.raw]);
      });
    }
    await rejected(h);
    expect(h.send).toHaveBeenCalledOnce();
    expect(h.bot.history).toHaveBeenCalledExactlyOnceWith(30);
  },
);

test.each([60000, 60001])(
  "dispatch 塔錨年齡%i ms（含60000，不加margin或TTL）",
  async (age) => {
    const h = setup();
    vi.mocked(h.bot.connect).mockImplementationOnce(() => {
      h.clock.mockReturnValue(native.anchor.date * 1000 + age);
      return Promise.resolve();
    });
    if (age === 60001) {
      await rejected(h);
    } else {
      const result = await invoke(h);
      expect(receipt(result)).toMatchObject({
        delivery: "submitted",
        code: "OUTCOME_UNKNOWN",
      });
      expect(h.wireSend).toHaveBeenCalledOnce();
    }
  },
);

test.each(["blood", "spring"] as const)(
  "正常%s只 send1，保留原生 receipt，沒有額外查詢或連打",
  async (decision) => {
    const h = setup(decision);
    const name = decision === "blood" ? BLOOD_SKILL : EARTH_SKILL;
    const result = await invoke(h, args(h, name));
    expect(result).toBe(await h.send.mock.results[0].value);
    expect(h.send).toHaveBeenCalledExactlyOnceWith(`/skill ${name}`, undefined);
    expect(h.wireSend).toHaveBeenCalledExactlyOnceWith(
      `/skill ${name}`,
      expect.any(AbortSignal),
    );
    expect(h.bot.history).toHaveBeenCalledTimes(2);
    expect(vi.mocked(h.bot.history).mock.calls.map((call) => call[0])).toEqual([
      30, 10,
    ]);
    expect(h.app.context.executeTool).not.toHaveBeenCalled();
    expect(currentDispatchCheck()).toBeUndefined();
  },
);

test("原生 captured 血怒回執保留完整text/revision，不將閃避或生還判為安全", async () => {
  const h = setup();
  const result = receipt(await invoke(h));
  expect(result.messages).toEqual([
    expect.objectContaining(native.blood.outgoing),
    expect.objectContaining(native.blood.reply),
  ]);
  expect(result.outcome).toBe("unknown");
  expect(result).not.toHaveProperty("riskVerified");
  expect(result).not.toHaveProperty("steps");
});

test.each(["blood", "spring", "recover", "stop"] as const)(
  "請求名稱不符%s決策不換招",
  async (decision) => {
    const h = setup(decision);
    await rejected(
      h,
      args(h, decision === "spring" ? BLOOD_SKILL : EARTH_SKILL),
    );
    expect(h.send).not.toHaveBeenCalled();
  },
);

test.each([960113, 960114, 960115, 960117, 960122, 960124])(
  "dispatch 最新 window 缺少相依source %i 即 send0（含 outgoing）",
  async (id) => {
    const h = setup();
    const plan = planTowerStep(h.app.store, h.snapshotId);
    expect(plan.sources.some((source) => source.messageId === id)).toBe(true);
    vi.mocked(h.bot.history).mockResolvedValueOnce(
      h.app.raw.filter((value) => value.id !== id),
    );
    await rejected(h);
  },
);

test.each([960113, 960114, 960115, 960117, 960122, 960124])(
  "dispatch source %i 同ID修訂即 send0",
  async (id) => {
    const h = setup();
    vi.mocked(h.bot.history).mockResolvedValueOnce(
      h.app.raw.map((value) =>
        value.id === id ? { ...value, revision: "changed" } : value,
      ),
    );
    await rejected(h);
  },
);

test.each([
  "identity",
  "pending_identity",
  "branch",
  "coverage",
  "unresolved",
  "unparsed",
  "spring",
  "recover",
  "stop",
])("入口後%s變更拒絕，不執行其他指令", async (change) => {
  const h = setup();
  vi.mocked(h.bot.history).mockImplementationOnce(() => {
    if (change === "branch") {
      h.app.store.reset();
    }
    if (change === "coverage") {
      h.app.store.observe([], undefined, 1);
    }
    const extra =
      change === "identity"
        ? message(960125, statusText("另一合成熊", 1000, 100))
        : change === "pending_identity"
          ? message(960125, "/switch 2", true)
          : change === "unresolved"
            ? message(960125, `/skill ${BLOOD_SKILL}`, true)
            : change === "unparsed"
              ? message(960125, "未解析的合成回覆")
              : ["spring", "recover", "stop"].includes(change)
                ? message(
                    960125,
                    statusText(
                      "合成控制熊",
                      900,
                      change === "recover" ? 31 : 100,
                      1000,
                      change === "stop" ? "野外" : "星塔前庭",
                    ),
                  )
                : undefined;
    return Promise.resolve([...h.app.raw, ...(extra ? [extra] : [])]);
  });
  await rejected(h);
});

test("入口取消 send0；dispatch 前取消同樣不送", async () => {
  const h = setup();
  await rejected(h, args(h), AbortSignal.abort());
  expect(h.send).not.toHaveBeenCalled();
  const cancel = new AbortController();
  vi.mocked(h.bot.history).mockImplementationOnce(() => {
    cancel.abort();
    return Promise.resolve([...h.app.raw]);
  });
  await rejected(h, args(h), cancel.signal);
});

test("保留既有外層 guard，先執行其限制且不永久影響普通 tools", async () => {
  const h = setup();
  const observe = vi.spyOn(h.app.store, "observe");
  const outer = vi.fn(() => {
    throw new Error("外層禁止送出");
  });
  await withDispatchCheck(outer, () => rejected(h));
  expect(outer).toHaveBeenCalledOnce();
  expect(observe).not.toHaveBeenCalled();
  expect(receipt(await invoke(h)).delivery).toBe("submitted");
  expect(outer).toHaveBeenCalledOnce();
  expect(currentDispatchCheck()).toBeUndefined();
  // 普通 skill 仍可沿原路徑送，不殘留塔策略 guard。
  h.clock.mockReturnValue(native.blood.outgoing.date * 1000);
  await h.app.tools
    .get("bears_skill")
    ?.execute(
      "ordinary",
      { name: BLOOD_SKILL },
      undefined,
      undefined,
      h.app.context,
    );
  expect(h.wireSend).toHaveBeenCalledTimes(2);
});

test("外層 guard 允許後仍檢查塔策略，外層不能延長60秒", async () => {
  const h = setup();
  const outer = vi.fn(() => {
    h.clock.mockReturnValue(native.blood.outgoing.date * 1000);
  });
  await withDispatchCheck(outer, () => rejected(h));
  expect(outer).toHaveBeenCalledOnce();
});

test.each(["text", "callback"])("實際action被改成%s拒絕送出", async (kind) => {
  const h = setup();
  h.send.mockImplementationOnce(async (_text, signal) => {
    try {
      return await gameToolResult(
        await h.game.act(
          kind === "text"
            ? { text: `/skill ${EARTH_SKILL}` }
            : { messageId: 960124, revision: "synthetic", row: 0, column: 0 },
          signal,
        ),
      );
    } catch (error) {
      return gameFailureResult(error);
    }
  });
  await rejected(h);
});

test("送後 history 失敗保留 OUTCOME_UNKNOWN，不重試或洗為未送", async () => {
  const h = setup();
  vi.mocked(h.bot.history)
    .mockResolvedValueOnce([...h.app.raw])
    .mockRejectedValueOnce(new Error("合成送後讀取失敗"));
  const result = receipt(await invoke(h));
  expect(result).toMatchObject({
    code: "OUTCOME_UNKNOWN",
    delivery: "unknown",
  });
  expect(h.wireSend).toHaveBeenCalledOnce();
  expect(h.send).toHaveBeenCalledOnce();
  expect(h.bot.history).toHaveBeenCalledTimes(2);
});

test("send 回傳未分類錯誤時不擅自標記 NOT_DISPATCHED", async () => {
  const h = setup();
  const failure = new Error("沒有delivery證據的錯誤");
  h.send.mockRejectedValueOnce(failure);
  await expect(invoke(h)).rejects.toBe(failure);
  expect(h.send).toHaveBeenCalledOnce();
});
