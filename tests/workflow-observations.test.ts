import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { combatSnapshot } from "../src/workflow-combat.js";
import {
  homeFacts,
  roomFacts,
  skillsFacts,
  statusFacts,
  towerFacts,
  WorkflowObservations,
} from "../src/workflow-observations.js";
import { reconcileRewards } from "../src/workflow-rewards.js";
import {
  homeText,
  inventoryText,
  message,
  NOW,
  roomText,
  skillsText,
  statusText,
  towerText,
  workflowHarness,
} from "./fixtures/workflow.js";

beforeEach(() => vi.spyOn(Date, "now").mockReturnValue(NOW));
afterEach(() => vi.restoreAllMocks());

test("既有 status 格式：分開保留資源、預估、位置；矛盾與錯誤數值不解析", () => {
  expect(statusFacts(message(1, statusText()))).toMatchObject({
    name: "測試熊",
    hp: 900,
    maxHp: 1000,
    gold: 1000,
    location: "星塔前庭",
    idle: false,
  });
  expect(
    statusFacts(message(1, statusText().replace("900/1000", "1001/1000"))),
  ).toBeUndefined();
  expect(
    statusFacts(message(1, statusText().replace("900/1000", "NaN/1000"))),
  ).toBeUndefined();
  expect(
    statusFacts(message(1, `${statusText()}\n含掛機預估`))?.estimated,
  ).toBe(true);
});

test("標籤式合成 tower、room、home、skills：只解析明示欄位，不推免費或成本", () => {
  expect(towerFacts(towerText())).toMatchObject({
    floor: 30,
    target: "合成星主",
    hp: 900,
    starts: Array.from({ length: 30 }, (_, i) => i + 1),
    pricing: { kind: "free", gold: 0 },
  });
  expect(
    towerFacts(towerText(30, 900, "王", "碎晶×2 或 300,000G（自動擇一）"))
      ?.pricing,
  ).toEqual({
    kind: "paid",
    gold: 300000,
    crystals: 2,
    automaticChoice: true,
    selectionConditions: [],
    selectionRule: null,
    quote: "入場費：碎晶×2 或 300,000G（自動擇一）",
  });
  expect(
    towerFacts(towerText().replace("HP：900/1000", "HP：1001/1000"))?.hp,
  ).toBeNull();
  expect(roomFacts(roomText("安全站", "北、南、上、下"))?.exits).toEqual([
    "北",
    "南",
    "上",
    "下",
  ]);
  expect(roomFacts(roomText("安全站", "北", "可休息"))?.freeRest).toBe(false);
  expect(homeFacts(homeText(1000, 0, "未知"))?.fee).toBeNull();
  expect(skillsFacts(skillsText)?.[0]).toMatchObject({
    name: "合成小招",
    mpCost: 12,
    hpCost: 0,
    expectedDamage: 200,
  });
  expect(
    skillsFacts(skillsText.replaceAll("無其他成本", "燃當前HP15%"))?.[0].hpCost,
  ).toBeNull();
});

test("沒有回覆的狀態變更也使舊觀測失效；原文不能續用舊執行資格", () => {
  const app = workflowHarness();
  const point = app.seed();
  app.store.observe([], "/attack 合成星主");
  expect(app.store.status()).toBeUndefined();
  expect(() => app.store.assertCurrent(point.id, "測試熊")).toThrow();
  expect(combatSnapshot(app.store, "tower").state).toBe("needs_observation");
});

test("新 status 日期不可信不能回退舊 HP；單則混角色或矛盾 vitals 不解析", () => {
  for (const age of [-61000, 61000]) {
    const app = workflowHarness();
    app.seed();
    app.store.observe(
      [
        message(
          100,
          statusText("測試熊", 0),
          false,
          Math.floor((NOW + age) / 1000),
        ),
      ],
      "/status",
    );
    expect(app.store.status()).toBeUndefined();
  }
  expect(
    statusFacts(message(1, `${statusText()}\nHP：0/1000 MP：60/100`)),
  ).toBeUndefined();
  expect(
    statusFacts(message(1, `${statusText()}\n${statusText("另一熊")}`)),
  ).toBeUndefined();
});

test("watch 缺頁後即使重新取得相同餘額，也不能將遺失區間宣稱閉帳", () => {
  const app = workflowHarness();
  const before = app.seed();
  vi.spyOn(Date, "now").mockReturnValue(NOW + 60000);
  app.store.observe([], undefined, 3);
  app.observe(statusText(), "/status");
  app.observe(inventoryText(), "/inventory all");
  app.observe(homeText(), "/home");
  const after = app.store.capture();
  const result = reconcileRewards(app.store, before.id, after.id);
  expect(result.state).toBe("needs_observation");
  expect(result.blockers.join(" ")).toContain("缺頁");
  expect(result.data.netGoldPerMinute).toBeNull();
});

test("技能主動耗血完整保留，百分比與其他成本未知時不補零", () => {
  const known = skillsFacts(
    "技能列表\n耗血斬（12MP）期望傷害：200；主動耗血：5HP；無其他成本",
  );
  expect(known?.[0]).toMatchObject({ hpCost: 5, costsComplete: true });
  const percent = skillsFacts(
    "技能列表\n耗血斬（12MP）期望傷害：200；主動耗血：10%HP；無其他成本",
  );
  expect(percent?.[0]).toMatchObject({ hpCost: null, costsComplete: false });
  expect(
    skillsFacts(
      "技能列表\n耗血斬（12MP）期望傷害：200；消耗1000G；無其他成本",
    )?.[0].costsComplete,
  ).toBe(false);
  const app = workflowHarness();
  app.seed();
  app.observe(
    "技能列表\n耗血斬（12MP）期望傷害：200；主動耗血：5HP；無其他成本",
    "/skills",
  );
  expect(
    combatSnapshot(app.store, "tower").data.plannerObservation,
  ).toMatchObject({
    actions: [{ hpCost: 5, costsComplete: true }],
  });
  expect(towerFacts(`${towerText()}\n怪物HP：800/1000`)?.hp).toBeNull();
  expect(
    towerFacts(`${towerText()}\n目標：另一隻王`)?.conflicts.length,
  ).toBeGreaterThan(0);
});

test("否定免費、已用免費與額外費用不當成零費用證據，樓層與技能不可有 NaN", () => {
  expect(
    towerFacts(
      `${towerText(30, 900, "王", "碎晶×2 或 300,000G（自動擇一）")}\n今日首戰免費已使用`,
    )?.pricing.kind,
  ).toBe("paid");
  expect(towerFacts(`${towerText()}\n入場費：300,000G`)?.pricing.kind).toBe(
    "unknown",
  );
  expect(towerFacts(towerText().replace("1–30", "1–3、30"))?.starts).toEqual([
    1, 2, 3, 30,
  ]);
  expect(
    towerFacts(towerText().replace("1–30", "9007199254740992"))?.starts,
  ).toEqual([]);
  expect(roomFacts(roomText("星塔前庭", "下", "不是免費休息"))?.freeRest).toBe(
    false,
  );
  expect(
    roomFacts(roomText("星塔前庭", "下", "裝備費用：0G（另收稅）"))?.equipFee,
  ).toBeNull();
  expect(homeFacts(homeText(1000, 0, "0G（另收稅）"))?.fee).toBeNull();
  expect(towerFacts(`${inventoryText()}\n材料出處：無盡星塔`)).toBeUndefined();
  expect(homeFacts(`${inventoryText()}\n材料出處：家園`)).toBeUndefined();
  expect(
    skillsFacts("材料說明\n技能列表\n測試招（12MP）期望傷害：200；無其他成本"),
  ).toBeUndefined();
  const app = workflowHarness();
  app.seed();
  app.observe(
    `${skillsText}\n不明技能（999999999999999999MP）期望傷害：100`,
    "/skills",
  );
  expect(combatSnapshot(app.store, "tower").state).toBe("needs_observation");
});

test("戰鬥快照原文綁定、完整性與 planner 觀測；不自動宣稱機制已證", () => {
  const app = workflowHarness();
  app.seed();
  const result = combatSnapshot(app.store, "tower");
  expect(result.state).toBe("ready");
  expect(result.data.riskVerified).toBe(false);
  expect(result.data.plannerObservation).toMatchObject({
    character: { name: "測試熊", hp: 900 },
    target: { floor: 30, name: "合成星主", hp: 900 },
  });
  expect(
    (result.data.plannerObservation as { risk?: unknown }).risk,
  ).toBeUndefined();
  expect(app.sent).toEqual([]);
  expect(combatSnapshot(app.store, "tower", "其他王").state).toBe(
    "needs_observation",
  );
});

test("boss 快照要求唯一現身目標；不由模糊名稱猜 HP", () => {
  const app = workflowHarness();
  app.seed();
  app.observe(roomText("星塔前庭", "下", "合成王 Lv80 HP：900/1000"), "/look");
  expect(combatSnapshot(app.store, "boss", "合成王").state).toBe("ready");
  app.observe(
    roomText(
      "星塔前庭",
      "下",
      "合成王 Lv80 HP：900/1000\n合成王 Lv80 HP：800/1000",
    ),
    "/look",
  );
  expect(combatSnapshot(app.store, "boss", "合成王").state).toBe(
    "needs_observation",
  );
});

test("來源過期、未來、重讀舊資料不刷新日期", () => {
  const app = workflowHarness();
  app.seed();
  vi.spyOn(Date, "now").mockReturnValue(NOW + 61000);
  app.store.observe(app.raw);
  expect(combatSnapshot(app.store, "tower").blockers.join(" ")).toContain(
    "/status",
  );
  vi.spyOn(Date, "now").mockReturnValue(NOW - 1000);
  expect(combatSnapshot(app.store, "tower").state).toBe("needs_observation");
});

test("切角、revision、watch 缺頁及分支重設使觀測失效，舊 generation 不回填", () => {
  const app = workflowHarness();
  const point = app.seed();
  const original = app.raw[0];
  app.store.observe([{ ...original, revision: "b".repeat(64) }]);
  expect(() => app.store.get(point.id)).toThrow("修訂");
  app.observe(statusText("乙熊"), "/status");
  expect(() => app.store.get(point.id)).toThrow("角色");
  const generation = app.store.generation;
  app.store.reset();
  app.store.observe([message(100, statusText())], "/status", 0, generation);
  expect(app.store.status()).toBeUndefined();
  app.observe(statusText(), "/status");
  app.store.observe([], undefined, 3);
  expect(app.store.status()).toBeUndefined();
});

test("可識別其他角色掛機報告不影響本人；未知活動使快照失效", () => {
  const app = workflowHarness();
  const point = app.seed();
  app.observe("【乙熊】\n🐾 掛機 1 小時，金幣 +100G");
  expect(app.store.assertCurrent(point.id, "測試熊").id).toBe(point.id);
  app.observe("外部戰鬥結果");
  expect(() => app.store.assertCurrent(point.id, "測試熊")).toThrow("失效");
});

test("完整背包多頁拼接、缺中頁及修訂來源不誤報完整", () => {
  const store = new WorkflowObservations();
  store.observe([message(1, statusText())], "/status");
  const lines = inventoryText().split("\n");
  store.observe(
    [
      message(2, lines.slice(0, 2).join("\n")),
      message(3, lines.slice(2, 3).join("\n")),
      message(4, lines.slice(3).join("\n")),
    ],
    "/inventory all",
  );
  expect(store.inventory()?.value.complete).toBe(true);
  const point = store.capture();
  expect(point.sources.map((source) => source.messageId)).toEqual([1, 2, 3, 4]);
  store.observe([{ ...message(3, lines[2]), revision: "b" }]);
  expect(() => store.get(point.id)).toThrow("修訂");
  const missing = new WorkflowObservations();
  missing.observe([message(1, statusText())], "/status");
  missing.observe(
    [
      message(2, lines.slice(0, 2).join("\n")),
      message(4, lines.slice(3).join("\n")),
    ],
    "/inventory all",
  );
  expect(missing.inventory()?.value.complete).toBe(false);
});

test("無副作用的同角色金幣對帳：編輯回執更新、不重複計數、掉落不估值", () => {
  const app = workflowHarness();
  const before = app.seed();
  const receipt = app.observe("獲得金幣：100G", "/attack 合成王");
  app.store.observe([receipt]);
  app.store.observe(
    [{ ...receipt, text: "獲得金幣：120G", revision: "c".repeat(64) }],
    "/attack 合成王",
  );
  vi.spyOn(Date, "now").mockReturnValue(NOW + 60000);
  app.observe(statusText("測試熊", 900, 60, 1120), "/status");
  app.observe(inventoryText(), "/inventory all");
  const after = app.store.capture();
  const result = reconcileRewards(app.store, before.id, after.id);
  expect(result.data.actualDelta).toBe(120);
  expect(result.data.credits).toBe(120);
  expect(result.data.unexplained).toBe(0);
  expect(result.data.events).toHaveLength(1);
  expect(result.state).toBe("confirmed");
  expect(app.sent).toEqual([]);
});

test("對帳：預估、未知活動、非閉合、同名物品、缺金庫或缺餘額只回報部分結果", () => {
  const app = workflowHarness();
  const before = app.seed();
  app.observe("預估金幣 +999G", "/idlestatus");
  app.observe("結果無法識別", "/skill 合成招");
  app.observe(`${statusText("測試熊", 900, 60, 1300)}\n含掛機預估`, "/status");
  const after = app.store.capture();
  const result = reconcileRewards(app.store, before.id, after.id);
  expect(result.state).toBe("needs_observation");
  expect(result.data.netGoldPerMinute).toBeNull();
  expect(result.blockers.join(" ")).toContain("預估");
  expect(result.data.unexplained).toBe(300);
});

test("對帳排除一次性／掛機結算速率，存款本金為中性轉移", () => {
  const app = workflowHarness();
  const before = app.seed();
  app.observe("存款成功：900G", "/deposit 900");
  app.observe(statusText("測試熊", 900, 60, 100), "/status");
  app.observe(homeText(100, 900), "/home");
  app.observe(inventoryText(), "/inventory all");
  const after = app.store.capture();
  const result = reconcileRewards(app.store, before.id, after.id);
  expect(result.data.actualDelta).toBe(0);
  expect(result.data.unexplained).toBe(0);
  expect(result.data.credits).toBe(0);
  expect(result.data.debits).toBe(0);
});
