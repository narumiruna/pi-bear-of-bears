import { expect, test } from "vitest";
import { classifyTask } from "../extensions/task-model.js";

test.each([
  ["幫我查看角色清單", "fast"],
  ["查看掛機進度", "fast"],
  ["/status", "fast"],
  ["你好", "fast"],
  ["hello", "fast"],
  ["謝謝", "fast"],
  ["做一個 extension", "deep"],
  ["commit and push", "deep"],
  ["git status", "deep"],
  ["比較裝備", "deep"],
  ["查看角色狀態並分析安全性", "deep"],
  ["爬塔", "deep"],
  ["研究資料", "deep"],
  ["不知道接下來要做什麼", "deep"],
  ["x".repeat(4001), "deep"],
  ["查看角色清單並刪除角色", "deep"],
])("任務分類：%s → %s", (prompt, profile) => {
  expect(classifyTask(prompt).profile).toBe(profile);
});

test("短續行保留任務，首次短訊息保守用 deep", () => {
  expect(classifyTask("1", "fast").profile).toBe("fast");
  expect(classifyTask("繼續", "deep").profile).toBe("deep");
  expect(classifyTask("continue").profile).toBe("deep");
});
