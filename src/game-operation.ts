import { AsyncLocalStorage } from "node:async_hooks";
import type { ButtonSelection, GameMessage } from "./game.js";

type DispatchCheck = (
  messages: GameMessage[],
  action: { text: string } | ButtonSelection,
) => void;
interface OperationState {
  ownership: AsyncLocalStorage<symbol>;
  dispatchCheck: AsyncLocalStorage<DispatchCheck>;
  active?: symbol;
}
// Pi 為每個 extension 建立獨立 jiti module cache，module 變數不足以跨 extension 排他。
const registry = globalThis as unknown as Record<
  symbol,
  OperationState | undefined
>;
const key = Symbol.for("pi-bear-of-bears.game-operation.v1");
const state = registry[key] ?? {
  ownership: new AsyncLocalStorage<symbol>(),
  dispatchCheck: new AsyncLocalStorage<DispatchCheck>(),
};
registry[key] = state;

export const currentDispatchCheck = () => state.dispatchCheck.getStore();
export function withDispatchCheck<T>(
  check: DispatchCheck,
  work: () => Promise<T>,
) {
  return state.dispatchCheck.run(check, work);
}

/** 程序內排他；只有同一 async 流程的子工具可重入，模型不能指定 owner。 */
export function assertGameOperationAvailable() {
  if (state.active && state.ownership.getStore() !== state.active) {
    throw new Error(
      "A Telegram operation is already running (workflow/Auto Idle).",
    );
  }
}

export async function withGameOperation<T>(work: () => Promise<T>): Promise<T> {
  assertGameOperationAvailable();
  if (state.active) {
    return work();
  }
  const owner = Symbol("game-operation");
  state.active = owner;
  try {
    return await state.ownership.run(owner, work);
  } finally {
    if (state.active === owner) {
      state.active = undefined;
    }
  }
}
