import { expect, test, vi } from "vitest";
import { LATE_REPLY_EVENT } from "../src/late-reply.js";
import { harness } from "./fixtures/goal-extension.js";

const evidence = {
  request: "/skill 血怒亂斬",
  outgoingId: 923722,
  messageId: 923723,
  revision: "a",
  originalSourceId: "source",
  actor: "狂戰",
  operationalEligibility: false,
};
async function waiting() {
  const app = harness();
  await app.command("goal", "狂戰爬塔");
  const result = app.settle(
    `第二手血怒結果未明，兩次補查用完，所有後續操作依賴此結果。收到新回覆後核本人資源。\n[goal:wait-external:${app.state().id}:923722]`,
  );
  return { app, result };
}
test("明確外部等待只提示一次，不空轉或偽完成，工具活動不解除", async () => {
  const { app, result } = await waiting();
  expect(result?.continue).toBe(false);
  expect(app.state()).toMatchObject({
    status: "paused",
    waitingExternal: true,
  });
  app.event("tool_execution_end", { isError: false, result: {} });
  for (let i = 0; i < 4; i++) {
    expect(app.settle("仍待回覆")).toBeUndefined();
  }
  expect(app.state()).toMatchObject({
    status: "paused",
    waitingExternal: true,
  });
  expect(app.sendMessage).toHaveBeenCalledOnce();
});
test("匹配候選只通知一次，無關事件不解除；明確恢復後才啟動", async () => {
  const { app } = await waiting();
  const count = vi.mocked(app.ctx.ui.notify).mock.calls.length;
  app.events.emit(LATE_REPLY_EVENT, { ...evidence, outgoingId: 99 });
  app.events.emit(LATE_REPLY_EVENT, evidence);
  app.events.emit(LATE_REPLY_EVENT, evidence);
  expect(app.state()).toMatchObject({
    status: "paused",
    waitingExternal: true,
  });
  expect(app.sendMessage).toHaveBeenCalledOnce();
  expect(app.ctx.ui.notify).toHaveBeenCalledTimes((count ?? 0) + 1);
  await app.command("goal-resume");
  expect(app.state().status).toBe("active");
  expect(app.sendMessage).toHaveBeenCalledTimes(2);
});
test("watch在最後補查與等待結算之間到達，仍保留一次候選通知", async () => {
  const app = harness();
  await app.command("goal", "驗證晚到競態");
  app.events.emit(LATE_REPLY_EVENT, evidence);
  const result = app.settle(
    `第二手血怒未決，補查額度用完，待原文核驗才能繼續。\n[goal:wait-external:${app.state().id}:923722]`,
  );
  expect(result?.continue).toBe(false);
  expect(app.state()).toMatchObject({
    status: "paused",
    waitingExternal: true,
    evidenceNotified: true,
  });
  expect(app.sendMessage).toHaveBeenCalledOnce();
});
test.each([
  "session_tree",
  "session_start",
  "session_shutdown",
  "停止",
  "reload",
])("%s後延遲訊息不自動恢復", async (mode) => {
  const { app } = await waiting();
  if (mode === "停止") {
    await app.command("goal-stop");
  } else if (mode === "reload") {
    app.events.emit("runtime:reload-pending", true);
    app.event("session_start");
  } else {
    app.event(mode);
  }
  app.events.emit(LATE_REPLY_EVENT, evidence);
  expect(app.sendMessage).toHaveBeenCalledOnce();
  if (mode !== "session_shutdown") {
    expect(app.state().status).not.toBe("active");
  }
});
test.each(["別的ID", "沒有理由", "零ID", "文字不是末行"])(
  "拒絕%s等待標記",
  async (mode) => {
    const app = harness();
    await app.command("goal", "驗證");
    const tag = `[goal:wait-external:${mode === "別的ID" ? crypto.randomUUID() : app.state().id}:${mode === "零ID" ? 0 : 923722}]`;
    app.settle(
      `${mode === "沒有理由" ? "" : "原因\n"}${tag}${mode === "文字不是末行" ? "\n其他文字" : ""}`,
    );
    expect(app.state().status).toBe("active");
  },
);
