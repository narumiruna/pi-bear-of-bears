const WATCH_GRACE_MS = 3000;

let activeOperation: "Auto Idle" | "Auto Equip" | undefined;
let suppressWatchUntil = 0;

export function autoIdleRunning() {
  return activeOperation === "Auto Idle";
}

export function suppressAutoIdleWatch(now = Date.now()) {
  return activeOperation !== undefined || now <= suppressWatchUntil;
}

function beginOperation(operation: "Auto Idle" | "Auto Equip") {
  if (activeOperation)
    throw new Error(`${activeOperation} 已在執行，請等待目前操作完成。`);
  activeOperation = operation;
  suppressWatchUntil = Number.POSITIVE_INFINITY;
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    activeOperation = undefined;
    suppressWatchUntil = Date.now() + WATCH_GRACE_MS;
  };
}

export function beginAutoIdle() {
  return beginOperation("Auto Idle");
}

export function beginAutoEquip() {
  return beginOperation("Auto Equip");
}

export function assertAutoIdleNotRunning() {
  if (activeOperation)
    throw new Error(
      `${activeOperation} 正在操作角色；為避免 Telegram 指令交錯，暫時拒絕其他遊戲工具。`,
    );
}
