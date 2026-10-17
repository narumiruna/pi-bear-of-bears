const WATCH_GRACE_MS = 3000;

let running = false;
let suppressWatchUntil = 0;

function autoIdleRunning() {
  return running;
}

function suppressAutoIdleWatch(now = Date.now()) {
  return running || now <= suppressWatchUntil;
}

function beginAutoIdle() {
  if (running) {
    throw new Error("Auto Idle 已在執行，請等待目前操作完成。");
  }
  running = true;
  suppressWatchUntil = Number.POSITIVE_INFINITY;
  let ended = false;
  return () => {
    if (ended) {
      return;
    }
    ended = true;
    running = false;
    suppressWatchUntil = Date.now() + WATCH_GRACE_MS;
  };
}

function assertAutoIdleNotRunning() {
  if (running) {
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
