import type { GameMessage } from "./game.js";
import { amount, homeFacts } from "./workflow-observations.js";
import type { WorkflowRunner } from "./workflow-runner.js";

const requireValue = <T>(value: T | null | undefined, reason: string): T => {
  if (value === null || value === undefined) {
    throw new Error(reason);
  }
  return value;
};
const homeParser = (message: GameMessage) => homeFacts(message.text);
export function depositAmount(
  cash: number,
  vault: number,
  thresholdPercent: number,
  targetPercent: number,
) {
  if (
    ![cash, vault, thresholdPercent, targetPercent].every(
      Number.isSafeInteger,
    ) ||
    cash < 0 ||
    vault < 0 ||
    thresholdPercent < 0 ||
    thresholdPercent > 100 ||
    targetPercent < 0 ||
    targetPercent >= thresholdPercent
  ) {
    throw new Error("存款策略或餘額無效。");
  }
  const total = BigInt(cash) + BigInt(vault);
  const deposit =
    total > 0n && BigInt(cash) * 100n > total * BigInt(thresholdPercent)
      ? BigInt(cash) - (total * BigInt(targetPercent)) / 100n
      : 0n;
  return { total: total.toString(), deposit: Number(deposit) };
}

export async function balanceWallet(
  run: WorkflowRunner,
  policy: {
    thresholdPercent: number;
    targetPercent: number;
    maxDeposit: number;
  },
) {
  const before = await run.status();
  const home = await run.step("bears_home", {}, homeParser);
  const cash = requireValue(before.gold, "缺少本人金幣。"),
    vault = requireValue(home.vault, "缺少同角色金庫餘額。");
  if (before.estimated || home.cash !== cash) {
    throw new Error("餘額含預估、缺少或兩來源矛盾。");
  }
  const calculation = depositAmount(
    cash,
    vault,
    policy.thresholdPercent,
    policy.targetPercent,
  );
  run.result.data.before = { cash, vault };
  run.result.data.calculation = calculation;
  if (!calculation.deposit) {
    run.result.state = "confirmed";
    run.result.data.deposited = 0;
    return;
  }
  const fee = requireValue(home.fee, "完整存款手續費未知。");
  if (before.location !== "熊熊溫暖的家" || !home.canDeposit) {
    throw new Error("沒有確認可用的同角色存款入口。");
  }
  if (
    !Number.isSafeInteger(vault + calculation.deposit) ||
    calculation.deposit > policy.maxDeposit ||
    fee > (run.scope?.maxGold ?? 0) ||
    BigInt(calculation.deposit) + BigInt(fee) > BigInt(cash)
  ) {
    throw new Error("本金或費用超出本次範圍／可用餘額。");
  }
  const checked = await run.status();
  const checkedHome = await run.step("bears_home", {}, homeParser);
  if (
    checked.gold !== cash ||
    checked.location !== before.location ||
    checkedHome.vault !== vault ||
    checkedHome.cash !== cash ||
    checkedHome.fee !== fee ||
    !checkedHome.canDeposit
  ) {
    throw new Error("送出前餘額、入口或完整費用已變更。");
  }
  await run.guard(run.result.sources.slice(-2));
  await run.step(
    "bears_deposit",
    { amount: calculation.deposit },
    (message) => {
      const deposited = amount(
        message.text,
        /(?:存入|存款成功[：:])\s*([\d,]+)\s*G/u,
      );
      return deposited === calculation.deposit &&
        !/無法|失敗/u.test(message.text)
        ? true
        : undefined;
    },
    true,
  );
  const after = await run.status();
  const afterHome = await run.step("bears_home", {}, homeParser);
  run.result.data.after = { cash: after.gold, vault: afterHome.vault };
  run.result.data.submittedDeposit = calculation.deposit;
  run.result.data.deposited =
    afterHome.vault === null ? null : afterHome.vault - vault;
  run.result.data.quotedFee = fee;
  run.result.data.observedTotalChange =
    after.gold === null || afterHome.vault === null
      ? null
      : (
          BigInt(after.gold) +
          BigInt(afterHome.vault) -
          BigInt(cash) -
          BigInt(vault)
        ).toString();
  if (
    after.gold !== cash - calculation.deposit - fee ||
    afterHome.cash !== after.gold ||
    afterHome.vault !== vault + calculation.deposit
  ) {
    throw new Error("存款後兩處餘額或實際費用不符；不補做第二筆。");
  }
  run.result.data.actualFee = fee;
  run.result.state = "confirmed";
}
