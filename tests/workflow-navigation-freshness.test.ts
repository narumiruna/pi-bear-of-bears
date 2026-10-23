import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  NOW,
  roomText,
  statusText,
  workflowHarness,
} from "./fixtures/workflow.js";

beforeEach(() => vi.spyOn(Date, "now").mockReturnValue(NOW));
afterEach(() => vi.restoreAllMocks());

test("導航只檢查角色與房間時效，不受仍在五分鐘內的舊背包阻擋", async () => {
  const app = workflowHarness();
  app.seed();
  vi.mocked(Date.now).mockReturnValue(NOW + 90_000);
  app.observe(statusText(), "/status");
  app.observe(roomText(), "/look");
  const snapshot = await app.call("bears_combat_snapshot", { mode: "boss" });
  const id = snapshot.data.snapshotId as string;
  // 原有全相依檢查仍拒絕超過一分鐘的來源，不放寬其他流程。
  expect(() => app.store.assertCurrent(id, "測試熊")).toThrow("快照已失效");
  const result = await app.call("bears_move_to", {
    scope: app.scope(id),
    destination: "安全站",
  });
  expect(result.state).toBe("confirmed");
  expect(result.blockers).toEqual([]);
  expect(app.sent.filter((command) => command.startsWith("/go "))).toEqual([
    "/go 下",
  ]);
  expect(app.sent).not.toContain("/inventory all");
});

test.each(["status_age", "room_update", "actor_change"])(
  "導航縮限相依來源後仍拒絕 %s，未派送步行",
  async (kind) => {
    const app = workflowHarness();
    app.seed();
    const snapshot = await app.call("bears_combat_snapshot", { mode: "boss" });
    const id = snapshot.data.snapshotId as string;
    if (kind === "status_age") {
      vi.mocked(Date.now).mockReturnValue(NOW + 61_000);
    } else if (kind === "room_update") {
      app.observe(roomText("星塔前庭", "北"), "/look");
    } else {
      app.observe(statusText("其他熊"), "/status");
    }
    const result = await app.call("bears_move_to", {
      scope: app.scope(id),
      destination: "安全站",
    });
    expect(result.state).toBe("stopped");
    expect(app.sent).toEqual([]);
  },
);
