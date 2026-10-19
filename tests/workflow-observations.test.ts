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

test.each([
  [
    "🌀 你撕開回城卷軸，一陣光芒將你捲回聚落…",
    "🏘️ 熊熊村廣場",
    "東→熊族市場",
    "熊熊村廣場",
  ],
  [
    "🌀 你啟動中繼傳送符，景色一轉，來到地圖中央的中繼站…",
    "💎 晶窟中繼站",
    "北→鐘乳石窟",
    "晶窟中繼站",
  ],
  [
    "☄️ 你握緊墜星碎片，大地在腳下裂開，你墜入了星淵地脈…",
    "⛺ 星淵豎井·營地",
    "上→星神祭壇",
    "星淵豎井·營地",
  ],
])("召回敘事不作房名：%s", (narration, heading, exits, name) => {
  const text = `${narration}\n${heading}\n\n🚪 出口：${exits}`;
  expect(roomFacts(text)?.name).toBe(name);
  expect(roomFacts(`${narration}\n🚪 出口：${exits}`)).toBeUndefined();
  const app = workflowHarness();
  app.seed();
  app.observe(text, "/recall");
  app.observe(statusText("測試熊", 900, 60, 1000, name), "/status");
  expect(combatSnapshot(app.store, "boss").data.room).toMatchObject({ name });
});

test("步行前綴仍不作房名，單獨房名與出口保持可解析", () => {
  expect(
    roomFacts(`你往東走去…\n${roomText("熊族市場", "西→熊熊村廣場")}`)?.name,
  ).toBe("熊族市場");
  expect(roomFacts(roomText("熊族市場", "西→熊熊村廣場"))?.name).toBe(
    "熊族市場",
  );
});

test("房間出口支援原生方向箭頭與全形空格，不從目的地名稱取方向", () => {
  expect(
    roomFacts(
      roomText(
        "晶窟中繼站",
        "北→鐘乳石窟　東→熔流裂罅　南→黑曜坡　西→晶簇洞·2　上→高台　下→地底",
      ),
    )?.exits,
  ).toEqual(["北", "南", "東", "西", "上", "下"]);
  expect(
    roomFacts(roomText("安全站", "東→北方石室　西→下層轉運站"))?.exits,
  ).toEqual(["東", "西"]);
});

test.each(["西→", "西→　", "西→、北→", "西→→入口"])(
  "不將缺少目的地的箭頭 %s 當成出口",
  (exits) => {
    expect(roomFacts(roomText("安全站", exits))?.exits).toEqual([]);
  },
);

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

// 格式取自 2026-10-18 的 /skills 749262、/look 749264；不代表戰鬥安全已驗證。
const liveSkills = `✨ 狂戰熊 技能（MP：406/422）
　普攻期望 1,892　對 🗿熔核巨像·維斯（DEF 1175）；技能數字＝一次施放期望，不含爆擊／被動

  /skill 血怒亂斬　MP:32　期望 11,220
　　連續 5 段爪擊（每段 100% 攻擊力），吸取 35% 傷害回血
  /skill 嗜血狂殺　MP:42　期望 13,694
　　燃燒 15% 當前HP，轟出 ATK×6.0 一擊並吸取 55% 傷害回血`;
const liveTarget = "  [809] 🗿 熔核巨像·維斯 Lv175  [████████] 54600/54600";

test("即時指令式技能保留多行說明，不把未列完整成本或百分比耗血補零", () => {
  const skills = skillsFacts(liveSkills);
  expect(skills).toHaveLength(2);
  expect(skills?.[0]).toMatchObject({
    name: "血怒亂斬",
    mpCost: 32,
    expectedDamage: 11220,
    hpCost: null,
    costsComplete: false,
  });
  expect(skills?.[1]).toMatchObject({
    name: "嗜血狂殺",
    mpCost: 42,
    expectedDamage: 13694,
    hpCost: null,
    costsComplete: false,
  });
  expect(skills?.[1].description).toContain("燃燒 15% 當前HP");
  expect(
    skillsFacts(liveSkills.replace("MP:32", "MP:999999999999999999")),
  ).toHaveLength(1);
  expect(skillsFacts(`材料說明\n${liveSkills}`)).toBeUndefined();
});

test("即時血條目標可唯一綁定；同名多隻及錯誤血量仍阻擋", () => {
  const app = workflowHarness();
  app.seed();
  app.observe(statusText("測試熊", 900, 60, 1000, "熔核熔洞"), "/status");
  app.observe(roomText("熔核熔洞", "北", liveTarget), "/look");
  const result = combatSnapshot(app.store, "boss", "熔核巨像·維斯");
  expect(result.state).toBe("ready");
  expect(result.data.plannerObservation).toMatchObject({
    target: { name: "熔核巨像·維斯", hp: 54600, present: true },
  });
  app.observe(
    roomText(
      "熔核熔洞",
      "北",
      `${liveTarget}\n${liveTarget.replace("809", "810")}`,
    ),
    "/look",
  );
  expect(combatSnapshot(app.store, "boss", "熔核巨像·維斯").blockers).toContain(
    "同名目標無法唯一識別。",
  );
  app.observe(
    roomText(
      "熔核熔洞",
      "北",
      liveTarget.replace("54600/54600", "54601/54600"),
    ),
    "/look",
  );
  expect(combatSnapshot(app.store, "boss", "熔核巨像·維斯").state).toBe(
    "needs_observation",
  );
});

test("即時技能已解析仍保留成本缺口，未知行不被當成介面標題忽略", () => {
  const app = workflowHarness();
  app.seed();
  app.observe(liveSkills, "/skills");
  app.observe(roomText("熔核熔洞", "北", liveTarget), "/look");
  const result = combatSnapshot(app.store, "boss", "熔核巨像·維斯");
  expect(result.data.skills).toHaveLength(2);
  expect(result.data.unparsedSkills).toEqual([]);
  expect(result.blockers).toContain(
    "技能完整成本或傷害未知，不補成已確認零值。",
  );
  expect(result.state).toBe("needs_observation");
  app.observe(
    liveSkills.replace("對 🗿熔核巨像·維斯（DEF 1175）", "對無防禦目標") +
      "\n\n🎁 裝備技能：\n  /skill 蛟鱗護體·神　MP:16　接下來 3 次受擊 DEF +20，並立即恢復最大HP的 20%（·神強化）",
    "/skills",
  );
  const support = combatSnapshot(app.store, "boss", "熔核巨像·維斯");
  expect(support.data.skills).toHaveLength(3);
  expect(support.data.unparsedSkills).toEqual([]);
  expect(support.state).toBe("needs_observation");
  app.observe(`${liveSkills}\n不明特殊消耗`, "/skills");
  expect(
    combatSnapshot(app.store, "boss", "熔核巨像·維斯").data.unparsedSkills,
  ).toContain("不明特殊消耗");
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

test("history 或 watch 遲到背包續頁仍綁定完整同批來源", () => {
  const store = new WorkflowObservations();
  const lines = inventoryText().split("\n");
  store.observe([message(1, statusText())], "/status");
  store.observe([message(2, "/inventory all", true)]);
  store.observe([message(3, lines.slice(0, 2).join("\n"))], "/inventory all");
  // history 與 watch 都可能沒有 request；不得只替最初 tool 回覆標記來源。
  store.observe([message(4, lines[2])]);
  store.observe([message(5, lines.slice(3).join("\n"))]);
  expect(store.inventory()?.value.complete).toBe(true);
  const point = store.capture();
  expect(point.sources.map((source) => source.messageId)).toEqual([1, 3, 4, 5]);
  expect(() => store.assertCurrent(point.id, "測試熊")).not.toThrow();

  store.observe([message(6, statusText())], "/status");
  const refreshed = store.capture();
  expect(() => store.assertCurrent(refreshed.id, "測試熊")).not.toThrow();
  // 後續不完整的新批次仍使舊來源失效，不能沿用完整舊庫。
  store.observe([message(7, lines.slice(0, 2).join("\n"))], "/inventory all");
  expect(() => store.assertCurrent(refreshed.id, "測試熊")).toThrow(
    "相關 inventory 觀測已失效或出現更新",
  );
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
