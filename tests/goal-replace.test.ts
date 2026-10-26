import { expect, test, vi } from "vitest";
import { harness } from "./fixtures/goal-extension.js";

function deferred() {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function replacing() {
  const app = harness();
  await app.command("goal", "obj1");
  const oldId = app.state().id;
  const idle = deferred();
  vi.mocked(app.ctx.isIdle).mockReturnValue(false);
  vi.mocked(app.ctx.waitForIdle).mockReturnValue(idle.promise);
  const replacement = app.command("goal", "obj2");
  await Promise.resolve();
  return { app, oldId, idle, replacement };
}

test("忙碌時先停止obj1並abort，等idle後只啟動obj2", async () => {
  const { app, oldId, idle, replacement } = await replacing();
  expect(app.entries()).toContainEqual(
    expect.objectContaining({
      data: expect.objectContaining({ id: oldId, status: "stopped" }),
    }),
  );
  expect(app.state()).toMatchObject({ objectives: "obj2", status: "paused" });
  expect(app.state().id).not.toBe(oldId);
  expect(app.ctx.abort).toHaveBeenCalledOnce();
  expect(app.ctx.waitForIdle).toHaveBeenCalledOnce();
  expect(app.sendMessage).toHaveBeenCalledOnce();
  app.event("agent_settled", { aborted: true });
  vi.mocked(app.ctx.isIdle).mockReturnValue(true);
  idle.resolve();
  await replacement;
  expect(app.state()).toMatchObject({ objectives: "obj2", status: "active" });
  expect(app.sendMessage).toHaveBeenCalledTimes(2);
  expect(app.settle(`[goal:complete:${oldId}]`)?.continue).toBe(true);
  expect(app.state().status).toBe("active");
});

test("連續覆蓋只啟動最後一個目標", async () => {
  const { app, idle, replacement } = await replacing();
  const latest = app.command("goal", "obj3");
  await Promise.resolve();
  expect(app.state()).toMatchObject({ objectives: "obj3", status: "paused" });
  vi.mocked(app.ctx.isIdle).mockReturnValue(true);
  idle.resolve();
  await Promise.all([replacement, latest]);
  expect(app.state()).toMatchObject({ objectives: "obj3", status: "active" });
  expect(app.sendMessage).toHaveBeenCalledTimes(2);
  expect(app.sendMessage.mock.calls[1][0].content).toContain("obj3");
});

test.each([
  "goal-stop",
  "session_tree",
  "session_start",
  "session_shutdown",
  "reload",
])("等待idle期間%s取消新目標啟動", async (event) => {
  const { app, idle, replacement } = await replacing();
  if (event === "goal-stop") {
    await app.command(event);
  } else if (event === "reload") {
    app.events.emit("runtime:reload-pending", true);
  } else {
    app.event(event);
  }
  vi.mocked(app.ctx.isIdle).mockReturnValue(true);
  idle.resolve();
  await replacement;
  expect(app.sendMessage).toHaveBeenCalledOnce();
  if (event === "goal-stop") {
    expect(app.state().status).toBe("stopped");
  }
});

test("等待中的目標不能被goal-resume提早啟動，無參數goal只查詢", async () => {
  const { app, idle, replacement } = await replacing();
  vi.mocked(app.ctx.isIdle).mockReturnValue(true);
  await app.command("goal-resume");
  await app.command("goal", "   ");
  expect(app.sendMessage).toHaveBeenCalledOnce();
  idle.resolve();
  await replacement;
  expect(app.sendMessage).toHaveBeenCalledTimes(2);
});

test("idle已被其他工作占用時不重疊啟動", async () => {
  const { app, idle, replacement } = await replacing();
  idle.resolve();
  await replacement;
  expect(app.state()).toMatchObject({ objectives: "obj2", status: "paused" });
  expect(app.sendMessage).toHaveBeenCalledOnce();
});

test.each(["abort", "sendMessage"] as const)(
  "%s失敗保留新目標paused，不恢復舊目標",
  async (operation) => {
    const app = harness();
    await app.command("goal", "obj1");
    if (operation === "abort") {
      vi.mocked(app.ctx.isIdle).mockReturnValue(false);
      vi.mocked(app.ctx.abort).mockImplementationOnce(() => {
        throw new Error("交接失敗");
      });
    } else {
      app.sendMessage.mockImplementationOnce(() => {
        throw new Error("交接失敗");
      });
    }
    await expect(app.command("goal", "obj2")).rejects.toThrow("交接失敗");
    expect(app.state()).toMatchObject({ objectives: "obj2", status: "paused" });
  },
);

test("waitForIdle失敗保留obj2 paused，不恢復obj1或重試", async () => {
  const app = harness();
  await app.command("goal", "obj1");
  vi.mocked(app.ctx.isIdle).mockReturnValue(false);
  vi.mocked(app.ctx.waitForIdle).mockRejectedValueOnce(new Error("無法等待"));
  await expect(app.command("goal", "obj2")).rejects.toThrow("無法等待");
  expect(app.state()).toMatchObject({ objectives: "obj2", status: "paused" });
  expect(app.sendMessage).toHaveBeenCalledOnce();
});

test("idle覆蓋仍記錄舊目標stopped，reload等待中拒絕新啟動", async () => {
  const app = harness();
  await app.command("goal", "obj1");
  const oldId = app.state().id;
  await app.command("goal", "obj2");
  expect(app.entries()).toContainEqual(
    expect.objectContaining({
      data: expect.objectContaining({ id: oldId, status: "stopped" }),
    }),
  );
  expect(app.ctx.abort).not.toHaveBeenCalled();
  app.events.emit("runtime:reload-pending", true);
  await app.command("goal", "obj3");
  expect(app.state().objectives).toBe("obj2");
  expect(app.sendMessage).toHaveBeenCalledTimes(2);
});
