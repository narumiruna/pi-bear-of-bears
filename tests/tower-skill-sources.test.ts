import { afterEach, expect, test, vi } from "vitest";
import { EARTH_SKILL } from "../src/tower-shield-budget.js";
import { planTowerStep } from "../src/workflow-tower-step.js";
import {
  args,
  invoke,
  native,
  receipt,
  rejected,
  setup,
} from "./fixtures/tower-skill-dispatch.js";

afterEach(() => vi.restoreAllMocks());

test.each(["spring", "recover"] as const)(
  "%s 的動作來源不包含未使用的舊盾；診斷來源仍保留",
  (decision) => {
    const h = setup(decision);
    const plan = planTowerStep(h.app.store, h.snapshotId);
    expect(plan.data.decision).toBe(decision);
    expect(plan.sources.map((source) => source.messageId)).toEqual([
      960122, 960124,
    ]);
    expect(plan.data.shieldBudget).toMatchObject({
      min: 2,
      sources: expect.arrayContaining([
        expect.objectContaining({ messageId: native.anchor.id }),
        expect.objectContaining({ messageId: native.spring.outgoing.id }),
        expect.objectContaining({ messageId: native.spring.reply.id }),
      ]),
    });
  },
);

test("新回春不借舊盾：舊錨過期且不在最新窗口，當前本人及塔況仍須新鮮", async () => {
  const h = setup("spring");
  expect(planTowerStep(h.app.store, h.snapshotId)).toMatchObject({
    state: "ready",
    data: { decision: "spring", shieldBudget: { min: 2 } },
  });
  vi.mocked(h.bot.history).mockImplementationOnce(() => {
    h.clock.mockReturnValue(native.anchor.date * 1000 + 70_000);
    return Promise.resolve(
      h.app.raw.filter((value) => value.id !== native.anchor.id),
    );
  });
  const result = receipt(await invoke(h, args(h, EARTH_SKILL)));
  expect(result.delivery).toBe("submitted");
  expect(h.wireSend).toHaveBeenCalledExactlyOnceWith(
    `/skill ${EARTH_SKILL}`,
    expect.any(AbortSignal),
  );
  expect(planTowerStep(h.app.store, h.snapshotId)).toMatchObject({
    state: "ready",
    data: { decision: "spring", shieldBudget: { min: null } },
  });
});

test.each([60_000, 60_001])(
  "新回春的當前本人來源%i ms邊界不因舊盾獨立而放寬",
  async (age) => {
    const h = setup("spring");
    h.clock.mockReturnValue((native.anchor.date + 47) * 1000 + age);
    if (age === 60_001) {
      await rejected(h, args(h, EARTH_SKILL));
    } else {
      expect(receipt(await invoke(h, args(h, EARTH_SKILL))).delivery).toBe(
        "submitted",
      );
      expect(h.wireSend).toHaveBeenCalledOnce();
    }
  },
);

test.each([960122, 960124])(
  "新回春仍須最新本人／塔況來源%i；缺少即不送",
  async (id) => {
    const h = setup("spring");
    vi.mocked(h.bot.history).mockResolvedValueOnce(
      h.app.raw.filter((value) => value.id !== id),
    );
    await rejected(h, args(h, EARTH_SKILL));
  },
);
