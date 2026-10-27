import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { towerFacts } from "../src/workflow-parsers.js";
import {
  NOW,
  statusText,
  towerText,
  workflowHarness,
} from "./fixtures/workflow.js";

const spring =
  "✨ 使用技能：地脈·萬物回春（MP -60）\n💚 恢復 550 HP！HP：1000/1000\n🛡️ 地脈之盾！接下來 3 次受擊減傷 24%";
const blood = (initiative = false, dodge = false) =>
  [
    "✨ 使用技能：血怒亂斬（MP -32）",
    ...(initiative
      ? [
          "💨 合成星主 搶得先機！",
          ...(dodge
            ? ["🌀 你閃過了 合成星主 的攻擊！"]
            : ["你受到 100 點傷害。HP：900/1000"]),
        ]
      : []),
    "🌀 連續攻擊 5 段：10＋10＋10＋10＋10 ＝ 共 50 傷害！　👻 HP：850/1000",
    "🩸 吸血！恢復 100 HP。HP：1000/1000",
    ...(dodge ? ["🌀 你閃過了 合成星主 的反擊！"] : []),
    `👻 反擊！你受到 ${dodge ? 0 : 100} 傷害。HP：${dodge ? 1000 : 900}/1000`,
  ].join("\n");

beforeEach(() => vi.spyOn(Date, "now").mockReturnValue(NOW));
afterEach(() => vi.restoreAllMocks());

function setup(withShield = true) {
  const app = workflowHarness();
  app.seed();
  let enemyHp = 900;
  if (withShield) {
    app.observe("/skill 地脈·萬物回春", undefined, true);
    app.observe(spring, "/skill 地脈·萬物回春");
  }
  const prepare = (mp = 100, hp = 1000, floor = 30, name = "合成星主") => {
    app.observe(statusText(app.state.name, hp, mp), "/status");
    const current = app.observe(towerText(floor, enemyHp, name), "/tower");
    const source = app.store
      .all()
      .find((record) => record.message.id === current.id)?.source;
    if (!source) {
      throw new Error("缺來源");
    }
    const point = app.store.capture([source]);
    return { snapshotId: point.id, policy: "blood-earth-32-60" };
  };
  const hit = (initiative = false, dodge = false) => {
    enemyHp = 850;
    app.observe("/skill 血怒亂斬", undefined, true);
    return app.observe(blood(initiative, dodge), "/skill 血怒亂斬");
  };
  return { app, prepare, hit };
}

test.each([32, 60, 91, 92, 100])(
  "滿 HP、三次盾、MP=%i 可選單手血怒，不一律要求 92",
  async (mp) => {
    const { app, prepare } = setup();
    const result = await app.call("bears_plan_tower_step", prepare(mp));
    expect(result).toMatchObject({
      state: "ready",
      steps: [],
      blockers: [],
      data: {
        decision: "blood",
        readOnly: true,
        riskVerified: false,
        shieldBudget: { min: 3, reductionPercent: 24 },
        recommendation: {
          tool: "bears_skill",
          arguments: { name: "血怒亂斬" },
        },
      },
    });
    expect(app.sent).toEqual([]);
    expect(app.context.executeTool).not.toHaveBeenCalled();
  },
);

test.each([0, 31])("MP=%i 不足血怒時只建議恢復", async (mp) => {
  const { app, prepare } = setup();
  expect(
    (await app.call("bears_plan_tower_step", prepare(mp))).data.decision,
  ).toBe("recover");
  expect(app.sent).toEqual([]);
});

test.each([32, 59, 60, 91, 92])("需要刷新時 MP=%i 的 92 邊界", async (mp) => {
  const { app, prepare } = setup(false);
  const result = await app.call("bears_plan_tower_step", prepare(mp));
  expect(result.data.decision).toBe(mp < 92 ? "recover" : "spring");
  expect(result.data.shieldBudget).toMatchObject({ min: null });
});

test("只有反擊耗一次保守預算；滿 HP 且剩二次可再選一手", async () => {
  const { app, prepare, hit } = setup();
  hit(false, true);
  const result = await app.call("bears_plan_tower_step", prepare(32));
  expect(result.data.shieldBudget).toMatchObject({ min: 2, issues: [] });
  expect(result.data.decision).toBe("blood");
});

test.each([false, true])(
  "先機＋反擊均耗預算，包括閃避=%s；不由滿 HP 借盾",
  async (dodge) => {
    const { app, prepare, hit } = setup();
    hit(true, dodge);
    const result = await app.call("bears_plan_tower_step", prepare(100));
    expect(result.data.shieldBudget).toMatchObject({ min: 1, issues: [] });
    expect(result.data.decision).toBe("spring");
  },
);

test("HP 未滿先刷新，不預借血怒吸血", async () => {
  const { app, prepare } = setup();
  expect(
    (await app.call("bears_plan_tower_step", prepare(100, 900))).data.decision,
  ).toBe("spring");
});

test.each(["/rest", "/flee", "/equip 1", "/tower go"])(
  "%s 後不沿用盾，也不串接操作",
  async (command) => {
    const { app, prepare } = setup();
    app.observe(command, undefined, true);
    const result = await app.call("bears_plan_tower_step", prepare());
    expect(result.data.shieldBudget).toMatchObject({ min: null });
    expect(result.data.decision).toBe("spring");
    expect(app.sent).toEqual([]);
  },
);

test("跨層即使同名、同 HP 上限也不能借盾", async () => {
  const { app, prepare } = setup();
  const result = await app.call(
    "bears_plan_tower_step",
    prepare(100, 1000, 31),
  );
  expect(result.data.shieldBudget).toMatchObject({ min: null });
  expect(result.data.decision).toBe("spring");
});

test.each([
  "未知新機制",
  blood().replace("MP -32", "MP -33"),
  spring.replace("24%", "25%"),
])("未支援格式或成本變動不產生技能建議", async (text) => {
  const { app, prepare } = setup();
  const name = text.includes("地脈·萬物回春") ? "地脈·萬物回春" : "血怒亂斬";
  app.observe(`/skill ${name}`, undefined, true);
  app.observe(text, `/skill ${name}`);
  const result = await app.call("bears_plan_tower_step", prepare());
  expect(result.state).toBe("needs_observation");
  expect(result.blockers.length).toBeGreaterThan(0);
  expect(result.data.recommendation).toBeUndefined();
});

test("技能未回覆不因新 status 補證，也不重送", async () => {
  const { app, prepare } = setup(false);
  app.observe("/skill 血怒亂斬", undefined, true);
  const result = await app.call("bears_plan_tower_step", prepare());
  expect(result.state).toBe("needs_observation");
  expect(result.blockers.join()).toContain("缺少直接綁定回覆");
  expect(app.sent).toEqual([]);
});

test("省略發生在回春後就不能補盾；新回春可建立新的局部區間", async () => {
  const { app, prepare } = setup();
  app.store.observe([], undefined, 1);
  const missing = await app.call("bears_plan_tower_step", prepare());
  expect(missing.state).toBe("needs_observation");
  app.observe("/skill 地脈·萬物回春", undefined, true);
  app.observe(spring, "/skill 地脈·萬物回春");
  const fresh = await app.call("bears_plan_tower_step", prepare());
  expect(fresh.data.decision).toBe("blood");
});

test("過期盾不因新 status 或 snapshotId 變新而刷新", async () => {
  const { app, prepare } = setup();
  vi.spyOn(Date, "now").mockReturnValue(NOW + 61_000);
  expect(
    (await app.call("bears_plan_tower_step", prepare())).data.shieldBudget,
  ).toMatchObject({ min: null });
});

test("已綁來源修訂、更新塔況或 reset 使快照失效", async () => {
  for (const change of ["revision", "tower", "reset"] as const) {
    const { app, prepare } = setup();
    const args = prepare();
    const current = app.store.latest((message) => towerFacts(message.text));
    if (!current) {
      throw new Error("缺塔況");
    }
    const raw = app.raw.find(
      (record) => record.id === current.source.messageId,
    );
    if (!raw) {
      throw new Error("缺原文");
    }
    if (change === "revision") {
      app.store.observe([{ ...raw, revision: "changed" }], "/tower");
    }
    if (change === "tower") {
      app.observe(towerText(31), "/tower");
    }
    if (change === "reset") {
      app.store.reset();
    }
    const result = await app.call("bears_plan_tower_step", args);
    expect(["stopped", "needs_observation"]).toContain(result.state);
    expect(result.blockers.length).toBeGreaterThan(0);
    expect(app.sent).toEqual([]);
  }
});

test("重複回春回覆不因選到最後一則就當成新盾", async () => {
  const { app, prepare } = setup();
  app.observe(spring, "/skill 地脈·萬物回春");
  const result = await app.call("bears_plan_tower_step", prepare());
  expect(result.state).toBe("needs_observation");
  expect(result.blockers.join()).toContain("重複");
});

test("同角色直接回覆仍須在先 outgoing，不能由 watch 後補施放歸屬", async () => {
  const { app, prepare } = setup(false);
  app.observe(spring, "/skill 地脈·萬物回春");
  const result = await app.call("bears_plan_tower_step", prepare());
  expect(result.state).toBe("needs_observation");
  expect(result.blockers.join()).toContain("outgoing");
});

test("新的完整收刀後可規劃刷新，不把 flee 套進技能 parser", async () => {
  const { app, prepare } = setup();
  app.observe("/flee", undefined, true);
  app.observe("💨 你趁亂逃跑了！", "/flee");
  expect(
    (await app.call("bears_plan_tower_step", prepare())).data.decision,
  ).toBe("spring");
});

test("已保存的王者重擊原文可扣一次盾；塔況與戰報使用一致的去圖示名稱", async () => {
  const { app } = setup(false);
  app.observe(
    towerText(100, 900, "星主·冰縛女妖").replace(
      "900/1000",
      "21182886/21182886",
    ),
    "/tower",
  );
  app.observe("/skill 地脈·萬物回春", undefined, true);
  app.observe(
    spring.replace("550 HP", "1672 HP").replace("1000/1000", "3040/3040"),
    "/skill 地脈·萬物回春",
  );
  app.observe("/skill 血怒亂斬", undefined, true);
  app.observe(
    readFileSync(
      new URL("./fixtures/native-royal-strike-831574.txt", import.meta.url),
      "utf8",
    ).trim(),
    "/skill 血怒亂斬",
  );
  app.observe(
    statusText(app.state.name).replace("900/1000", "1520/3040"),
    "/status",
  );
  const tower = app.observe(
    towerText(100, 850, "星主·冰縛女妖").replace(
      "850/1000",
      "21075861/21182886",
    ),
    "/tower",
  );
  const source = app.store
    .all()
    .find((record) => record.message.id === tower.id)?.source;
  if (!source) {
    throw new Error("缺來源");
  }
  const result = await app.call("bears_plan_tower_step", {
    snapshotId: app.store.capture([source]).id,
    policy: "blood-earth-32-60",
  });
  expect(result.data.shieldBudget).toMatchObject({ min: 2, issues: [] });
  expect(result.data.decision).toBe("recover");
  expect(app.sent).toEqual([]);
});

test("同層怪血意外變化不能繼續借用盾", async () => {
  const { app, prepare } = setup();
  prepare();
  const current = app.observe(towerText(30, 899), "/tower");
  const source = app.store
    .all()
    .find((record) => record.message.id === current.id)?.source;
  if (!source) {
    throw new Error("缺來源");
  }
  const result = await app.call("bears_plan_tower_step", {
    snapshotId: app.store.capture([source]).id,
    policy: "blood-earth-32-60",
  });
  expect(result.state).toBe("needs_observation");
  expect(result.blockers.join()).toContain("怪血");
});

test("回春原文修訂後不以新版內容重播舊效果壽命", async () => {
  const { app, prepare } = setup();
  const original = app.raw.find((message) => message.text === spring);
  if (!original) {
    throw new Error("缺回春");
  }
  app.store.observe(
    [{ ...original, revision: "changed" }],
    "/skill 地脈·萬物回春",
  );
  const result = await app.call("bears_plan_tower_step", prepare());
  expect(result.state).toBe("needs_observation");
  expect(result.blockers.join()).toContain("修訂");
});

test("新角色只能建立自己的預算，不沿前角盾", async () => {
  const { app, prepare } = setup();
  app.state.name = "另一熊";
  const result = await app.call("bears_plan_tower_step", prepare());
  expect(result.actor).toBe("另一熊");
  expect(result.data.shieldBudget).toMatchObject({ min: null });
  expect(result.data.decision).toBe("spring");
});

test.each(["/attack", "/attack 合成星主"])(
  "%s 未回覆不因 status 獨立成功而重選攻擊",
  async (command) => {
    const { app, prepare } = setup(false);
    app.observe(command, undefined, true);
    const result = await app.call("bears_plan_tower_step", prepare());
    expect(result.state).toBe("needs_observation");
    expect(app.sent).toEqual([]);
  },
);

test("掛機、死亡與野外都不選施法", async () => {
  for (const [hp, suffix, location] of [
    [0, "", "星塔前庭"],
    [900, "\n🐾 掛機中", "星塔前庭"],
    [900, "", "野外"],
  ] as const) {
    const { app, prepare } = setup(false);
    prepare();
    app.observe(
      statusText(app.state.name, hp, 100, 1000, location) + suffix,
      "/status",
    );
    const tower = app.store.latest((message) => towerFacts(message.text));
    if (!tower) {
      throw new Error("缺塔況");
    }
    const result = await app.call("bears_plan_tower_step", {
      snapshotId: app.store.capture([tower.source]).id,
      policy: "blood-earth-32-60",
    });
    expect(result.data.decision).toBe("stop");
    expect(result.data.recommendation).toBeNull();
  }
});

test("取消不啟動任何子工具", async () => {
  const { app, prepare } = setup();
  await expect(
    app.call("bears_plan_tower_step", prepare(), AbortSignal.abort()),
  ).rejects.toThrow();
  expect(app.sent).toEqual([]);
});
