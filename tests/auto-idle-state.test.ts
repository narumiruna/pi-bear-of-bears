import { afterEach, expect, test, vi } from "vitest";
import {
  assertAutoIdleNotRunning,
  autoIdleRunning,
  beginAutoEquip,
  beginAutoIdle,
  suppressAutoIdleWatch,
} from "../src/auto-idle-state.js";

let end: (() => void) | undefined;

afterEach(() => {
  end?.();
  end = undefined;
  vi.useRealTimers();
});

test("同一程序只允許一個批次角色操作，結束後保留 watch 緩衝期", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-09T00:00:00Z"));
  end = beginAutoIdle();
  expect(autoIdleRunning()).toBe(true);
  expect(suppressAutoIdleWatch()).toBe(true);
  expect(() => beginAutoIdle()).toThrow("已在執行");
  expect(() => assertAutoIdleNotRunning()).toThrow("指令交錯");

  end();
  end = undefined;
  expect(autoIdleRunning()).toBe(false);
  expect(suppressAutoIdleWatch()).toBe(true);
  vi.advanceTimersByTime(3001);
  expect(suppressAutoIdleWatch()).toBe(false);
  expect(assertAutoIdleNotRunning()).toBeUndefined();

  end = beginAutoEquip();
  expect(autoIdleRunning()).toBe(false);
  expect(suppressAutoIdleWatch()).toBe(true);
  expect(() => beginAutoIdle()).toThrow("Auto Equip 已在執行");
  expect(() => assertAutoIdleNotRunning()).toThrow("Auto Equip 正在操作角色");
});
