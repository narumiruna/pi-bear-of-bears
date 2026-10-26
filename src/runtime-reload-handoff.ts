import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

interface GoalIdentity {
  id: string;
  status: string;
}

export function reloadGoal(ctx: ExtensionContext): GoalIdentity | undefined {
  let goal: GoalIdentity | undefined;
  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type !== "custom" || entry.customType !== "goal.state") {
      continue;
    }
    const value = entry.data as Partial<GoalIdentity> | null;
    goal =
      value && typeof value.id === "string" && typeof value.status === "string"
        ? { id: value.id, status: value.status }
        : undefined;
  }
  return goal;
}

export interface ReloadContinuation {
  goalId: string;
  context: ExtensionContext;
  resumed: boolean;
}

export interface ReloadHandoff {
  sessionId: string;
  leafId: string | null;
  goalId?: string;
  passiveGoal?: GoalIdentity;
  result: Promise<boolean>;
  finish: (success: boolean) => void;
}

// Extension模組可能被重新求值；只交接process內plain ticket，不保存舊pi/context。
// 不落盤，普通啟動／process重啟不會從歷史紀錄重啟Agent。
const key = Symbol.for("pi-bear-of-bears.reload-handoffs.v1");
const globals = globalThis as unknown as Record<
  symbol,
  Map<string, ReloadHandoff> | undefined
>;
const tickets: Map<string, ReloadHandoff> = globals[key] ?? new Map();
globals[key] = tickets;

export function armReload(
  ctx: ExtensionContext,
  goalId?: string,
): ReloadHandoff {
  const sessionId = ctx.sessionManager.getSessionId();
  tickets.get(sessionId)?.finish(false);
  let complete = (_success: boolean) => {};
  const ticket: ReloadHandoff = {
    sessionId,
    leafId: ctx.sessionManager.getLeafId(),
    goalId,
    passiveGoal: goalId ? undefined : reloadGoal(ctx),
    result: new Promise<boolean>((resolve) => {
      complete = resolve;
    }),
    finish(success) {
      if (tickets.get(sessionId) === ticket) {
        tickets.delete(sessionId);
      }
      complete(success);
    },
  };
  tickets.set(sessionId, ticket);
  return ticket;
}

export function claimReload(ctx: ExtensionContext): ReloadHandoff | undefined {
  const sessionId = ctx.sessionManager.getSessionId();
  const ticket = tickets.get(sessionId);
  tickets.delete(sessionId); // consume先於派送；不重試不明結果。
  return ticket;
}

export function reloadBranchMatches(
  ticket: ReloadHandoff,
  ctx: ExtensionContext,
) {
  if (ctx.sessionManager.getSessionId() !== ticket.sessionId) {
    return false;
  }
  const branch = ctx.sessionManager.getBranch();
  const index = ticket.leafId
    ? branch.findIndex((entry) => entry.id === ticket.leafId)
    : -1;
  if (ticket.leafId && index < 0) {
    return false;
  }
  return !branch
    .slice(index + 1)
    .some((entry) => entry.type === "message" && entry.message.role === "user");
}
