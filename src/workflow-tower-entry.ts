import { cleanName, type towerFacts } from "./workflow-observations.js";
import type { WorkflowRunner } from "./workflow-runner.js";

function entryPayment(
  tower: NonNullable<ReturnType<typeof towerFacts>>,
  gold: number | null,
  crystals: number | null,
) {
  const blockers: string[] = [];
  const quote = tower.pricing;
  let selected: { currency: string; amount: number } | null =
    quote.kind === "free" ? { currency: "free", amount: 0 } : null;
  if (quote.kind !== "paid") {
    return { blockers, selected };
  }
  if (
    quote.automaticChoice ||
    (quote.gold !== null && quote.crystals !== null)
  ) {
    if (
      quote.selectionRule !== "crystals_first_then_gold" ||
      quote.gold === null ||
      quote.crystals === null
    ) {
      blockers.push("自動擇一的扣款條件未完整確認，不推定優先扣材料。");
    } else if (crystals === null) {
      blockers.push("本人碎晶存量未知，不能選擇實際扣款分支。");
    } else {
      selected =
        crystals >= quote.crystals
          ? { currency: "crystals", amount: quote.crystals }
          : { currency: "gold", amount: quote.gold };
    }
  } else if (quote.crystals !== null) {
    selected = { currency: "crystals", amount: quote.crystals };
  } else if (quote.gold !== null) {
    selected = { currency: "gold", amount: quote.gold };
  }
  if (
    selected === null &&
    quote.gold !== null &&
    quote.crystals !== null &&
    gold !== null &&
    crystals !== null &&
    gold < quote.gold &&
    crystals < quote.crystals
  ) {
    blockers.push("兩種入場資源均不足。");
  }
  if (
    selected?.currency === "gold" &&
    (gold === null || gold < selected.amount)
  ) {
    blockers.push("金幣不足或未知。");
  }
  if (
    selected?.currency === "crystals" &&
    (crystals === null || crystals < selected.amount)
  ) {
    blockers.push("碎晶不足或未知。");
  }
  return { blockers, selected };
}

export async function towerEntryCheck(
  run: WorkflowRunner,
  character: string,
  floor?: number,
  freeOnly = false,
) {
  const status = await run.status();
  if (status.name !== character || status.idle) {
    throw new Error("角色不符或掛機中，未查詢可能中斷掛機的入口。");
  }
  const tower = await run.prepareObservation("tower", true);
  let inventory = run.store.inventory();
  if (
    tower.pricing.kind === "paid" &&
    !inventory?.value.complete &&
    tower.pricing.crystals !== null
  ) {
    await run.prepareInventory();
    inventory = run.store.inventory();
  }
  const crystals = inventory?.value.complete
    ? inventory.value.entries.filter(
        (item) => cleanName(item.name) === "星核碎晶",
      )
    : [];
  const held =
    crystals.length === 1 &&
    Number.isSafeInteger(crystals[0].count) &&
    crystals[0].count >= 0
      ? crystals[0].count
      : inventory?.value.complete && crystals.length === 0
        ? 0
        : null;
  run.result.data = {
    ...run.result.data,
    tower,
    requestedFloor: floor ?? null,
    heldCrystals: held,
    cash: status.gold,
    eligible: floor === undefined ? null : tower.starts.includes(floor),
    freeOnly,
  };
  if (
    tower.pricing.kind === "unknown" ||
    !tower.challengeKnown ||
    tower.starts.length === 0
  ) {
    run.result.blockers.push("入場完整費用、挑戰或可選樓層未知。");
  }
  if (floor !== undefined && !tower.starts.includes(floor)) {
    run.result.blockers.push("指定樓層不在當次可選範圍。");
  }
  if (freeOnly && tower.pricing.kind !== "free") {
    run.result.blockers.push("當次免費資格尚未完整核驗，不入塔確認價格。");
  }
  if (status.estimated) {
    run.result.blockers.push("餘額含掛機預估，不作入場資源證明。");
  }
  const payment = entryPayment(tower, status.gold, held);
  run.result.blockers.push(...payment.blockers);
  run.result.data.selectedPayment = payment.selected;
  run.result.data.snapshotId = run.store.capture(run.result.sources).id;
  run.result.state =
    run.result.blockers.length > 0 ? "needs_observation" : "ready";
}
