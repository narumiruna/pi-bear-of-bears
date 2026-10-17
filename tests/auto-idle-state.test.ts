import { afterEach, expect, test, vi } from "vitest";
import {
  assertAutoIdleNotRunning,
  autoIdleRunning,
  beginAutoIdle,
  suppressAutoIdleWatch,
} from "../src/auto-idle-state.js";

let end: (() => void) | undefined;

afterEach(() => {
  end?.();
  end = undefined;
  vi.useRealTimers();
});

test("Auto Idle 排他執行，結束後保留 watch 緩衝期且可重複清理", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-09T00:00:00Z"));
  end = beginAutoIdle();
  expect(autoIdleRunning()).toBe(true);
  expect(suppressAutoIdleWatch()).toBe(true);
  expect(() => beginAutoIdle()).toThrow("已在執行");
  expect(() => assertAutoIdleNotRunning()).toThrow("指令交錯");

  const finishFirst = end;
  finishFirst();
  end = undefined;
  expect(autoIdleRunning()).toBe(false);
  expect(suppressAutoIdleWatch()).toBe(true);
  vi.advanceTimersByTime(3001);
  expect(suppressAutoIdleWatch()).toBe(false);
  expect(assertAutoIdleNotRunning()).toBeUndefined();

  end = beginAutoIdle();
  finishFirst();
  expect(autoIdleRunning()).toBe(true);
  expect(suppressAutoIdleWatch()).toBe(true);
  expect(() => beginAutoIdle()).toThrow("Auto Idle 已在執行");
  expect(() => assertAutoIdleNotRunning()).toThrow("Auto Idle 正在操作角色");
});
