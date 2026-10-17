import { assertGameOperationAvailable } from "./game-operation.js";

const WATCH_GRACE_MS = 3000;
interface AutoIdleState {
  running: boolean;
  suppressWatchUntil: number;
}
// 與跨 extension 的流程鎖相同，必須跨 jiti module cache 共用狀態。
const registry = globalThis as unknown as Record<
  symbol,
  AutoIdleState | undefined
>;
const key = Symbol.for("pi-bear-of-bears.auto-idle-state.v1");
const state = registry[key] ?? { running: false, suppressWatchUntil: 0 };
registry[key] = state;

function autoIdleRunning() {
  return state.running;
}
function suppressAutoIdleWatch(now = Date.now()) {
  return state.running || now <= state.suppressWatchUntil;
}
function beginAutoIdle() {
  assertGameOperationAvailable();
  if (state.running) {
    throw new Error("Auto Idle 已在執行，請等待目前操作完成。");
  }
  state.running = true;
  state.suppressWatchUntil = Number.POSITIVE_INFINITY;
  let ended = false;
  return () => {
    if (ended) {
      return;
    }
    ended = true;
    state.running = false;
    state.suppressWatchUntil = Date.now() + WATCH_GRACE_MS;
  };
}
function assertAutoIdleNotRunning() {
  assertGameOperationAvailable();
  if (state.running) {
    throw new Error(
      "Auto Idle 正在操作角色；為避免 Telegram 指令交錯，暫時拒絕其他遊戲工具。",
    );
  }
}

export {
  assertAutoIdleNotRunning,
  autoIdleRunning,
  beginAutoIdle,
  suppressAutoIdleWatch,
};
