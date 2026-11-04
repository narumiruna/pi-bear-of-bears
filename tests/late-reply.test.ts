import { expect, test } from "vitest";
import type { GameMessage } from "../src/game.js";
import { LateReplyCandidates } from "../src/late-reply.js";

const msg = (id: number, text: string, outgoing = false): GameMessage => ({
  id,
  text,
  outgoing,
  date: id,
  revision: String(id),
  buttons: [],
  hasMedia: false,
});
const status = msg(
  1,
  "🐺 測試熊　狂戰熊 二轉Lv80\n─────────────────\nHP：3040/3040　MP：422/422\nATK：3860\nDEF：6050\nINT：1000\nAGI：826\n金幣：100\nEXP：滿級\n位置：🗼 星塔前庭",
);
const outgoing = msg(2, "/skill 地脈·萬物回春", true);
const reply = msg(
  3,
  "✨ 使用技能：地脈·萬物回春（MP -60）\n🛡️ 地脈·萬物回春！接下來 3 次受擊減傷 24%\n💚 恢復 1672 HP！HP：3040/3040",
);
function setup() {
  const tracker = new LateReplyCandidates();
  tracker.observe([status], "status-source");
  tracker.expect(outgoing.text);
  return tracker;
}
test("送達無回覆、兩次空觀測後，新原文僅產生一次待核候選", () => {
  const tracker = setup();
  tracker.observe([outgoing], "outgoing-source");
  tracker.observe([], "history1");
  tracker.observe([], "history2");
  expect(tracker.observe([reply], "late-source")).toEqual([
    expect.objectContaining({
      outgoingId: 2,
      messageId: 3,
      actor: "測試熊",
      originalSourceId: "late-source",
      operationalEligibility: false,
    }),
  ]);
  expect(tracker.observe([reply], "repeat")).toEqual([]);
});
test("本次晚到血怒原文只列候選來源，不認領戰果或資源", () => {
  const tracker = new LateReplyCandidates();
  tracker.observe([status], "status-source");
  tracker.expect("/skill 血怒亂斬");
  tracker.observe([msg(2, "/skill 血怒亂斬", true)], "outgoing");
  const text =
    "✨ 使用技能：血怒亂斬（MP -32）\n（🌟星淵共鳴×1+9%）\n🌀 連續攻擊 5 段：1065＋1067＋1062＋1065＋1067 ＝ 共 5326 傷害！ 🕷️ HP：16657889/16677710\n🩸 吸血！恢復 1864 HP。HP：3040/3040\n🌵 荊棘反傷 4229！🕷️ HP：16653660/16677710\n🛡️ 星塔庇護：單次傷害至多 1,520（你血量上限的 50%）\n\n🕷️ 反擊！你受到 1520 傷害。HP：1520/3040";
  expect(tracker.observe([msg(3, text)], "blood-source")).toEqual([
    expect.objectContaining({
      request: "/skill 血怒亂斬",
      originalSourceId: "blood-source",
      operationalEligibility: false,
    }),
  ]);
});
test.each(["公告", "孤立", "換角", "修訂", "省略", "分支", "其他指令"])(
  "%s不產生可認領回覆",
  (mode) => {
    const tracker = setup();
    if (mode !== "孤立") {
      tracker.observe([outgoing], "anchor");
    }
    if (mode === "換角") {
      tracker.observe([msg(3, "/switch 另一熊", true)], "switch");
    }
    if (mode === "修訂") {
      tracker.observe([{ ...outgoing, revision: "edited" }], "edit");
    }
    if (mode === "省略") {
      tracker.observe([], "omitted", 1);
    }
    if (mode === "分支") {
      tracker.reset();
    }
    if (mode === "其他指令") {
      tracker.observe([msg(3, "/status", true)], "query");
    }
    expect(
      tracker.observe(
        [mode === "公告" ? msg(4, "神話降臨！") : { ...reply, id: 4 }],
        "new",
      ),
    ).toEqual([]);
  },
);
