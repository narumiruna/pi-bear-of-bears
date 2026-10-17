import type { EquipmentWeights } from "./equipment-optimizer.js";
import type { EquipmentSnapshot } from "./equipment-snapshot.js";
import type { GameMessage } from "./game.js";
import { findRoomPath } from "./room-route.js";
import {
  cleanName,
  type Direction,
  roomFacts,
  towerFacts,
} from "./workflow-observations.js";
import type { WorkflowRunner } from "./workflow-runner.js";
import type { WorldMap } from "./world.js";

const requireValue = <T>(value: T | null | undefined, reason: string): T => {
  if (value === null || value === undefined) {
    throw new Error(reason);
  }
  return value;
};
const roomParser = (message: GameMessage) => roomFacts(message.text);
const towerParser = (message: GameMessage) => towerFacts(message.text);
const sameGold = (before: number | null, after: number | null) => {
  if (before === null || after === null || before !== after) {
    throw new Error("實際金幣費用不符或無法確認，停止本流程。");
  }
};

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
  const tower = await run.step("bears_tower", {}, towerParser);
  let inventory = run.store.inventory();
  if (
    tower.pricing.kind === "paid" &&
    !inventory?.value.complete &&
    tower.pricing.crystals !== null
  ) {
    await run.step("bears_inventory", { all: true }, (message) => {
      const view = run.store.inventory();
      return view?.value.complete &&
        view.sources.some((source) => source.messageId === message.id)
        ? true
        : undefined;
    });
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
    run.result.blockers.push("當次未明示免費，不入塔確認價格。");
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

function preparedTower(run: WorkflowRunner) {
  const point = run.scope ? run.store.get(run.scope.snapshotId) : undefined;
  const source = point?.sources.find(
    (item) => run.store.channel(item) === "tower",
  );
  const record = run.store
    .all()
    .find((item) => item.message.id === source?.messageId);
  return record ? towerFacts(record.message.text) : undefined;
}

export async function towerRecover(run: WorkflowRunner) {
  const before = await run.status();
  if (before.estimated) {
    throw new Error("不能用掛機預估餘額核對恢復費用。");
  }
  const original = await run.step("bears_tower", {}, towerParser);
  if (original.floor === null || original.hp === null || !original.target) {
    throw new Error("沒有可確認的目前挑戰與怪血。");
  }
  run.result.data.before = { status: before, tower: original };
  const prepared = preparedTower(run);
  run.result.data.preparedChallenge = prepared ?? null;
  if (
    !prepared ||
    prepared.floor !== original.floor ||
    prepared.target !== original.target ||
    prepared.hp !== original.hp
  ) {
    throw new Error("目前挑戰與準備快照不符或缺少綁定，未收刀或休息。");
  }
  if (before.hp === before.maxHp && before.mp === before.maxMp) {
    run.result.state = "confirmed";
    run.result.data.recovered = { hp: 0, mp: 0, gold: 0 };
    return;
  }
  let room = await run.step("bears_look", {}, roomParser);
  if (room.name !== "星塔前庭" || before.location !== room.name) {
    throw new Error("不在已確認的星塔前庭；不對野外戰鬥套用收刀保血流程。");
  }
  if (room.inCombat) {
    await run.guard(run.result.sources.slice(-3));
    await run.step(
      "bears_flee",
      {},
      (message) =>
        /收刀|成功逃離/u.test(message.text) && !/無法|失敗/u.test(message.text)
          ? true
          : undefined,
      true,
    );
    await run.status();
    room = await run.step("bears_look", {}, roomParser);
    const retained = await run.step("bears_tower", {}, towerParser);
    if (
      retained.floor !== original.floor ||
      retained.target !== original.target ||
      retained.hp !== original.hp
    ) {
      throw new Error("收刀後挑戰或怪血已改變，不休息。");
    }
  }
  if (
    room.name !== "星塔前庭" ||
    !room.freeRest ||
    !room.restLocation ||
    room.inCombat
  ) {
    throw new Error("未確認星塔前庭可免費恢復，不送出休息。");
  }
  await run.guard(run.result.sources.slice(-3));
  await run.step(
    "bears_rest",
    {},
    (message) =>
      /休息|恢復/u.test(message.text) &&
      /免費/u.test(message.text) &&
      !/無法|失敗|不足/u.test(message.text)
        ? true
        : undefined,
    true,
  );
  const after = await run.status();
  const current = await run.step("bears_tower", {}, towerParser);
  run.result.data.after = { status: after, tower: current };
  run.result.data.recovered = {
    hp: after.hp - before.hp,
    mp: after.mp - before.mp,
    gold:
      before.gold !== null && after.gold !== null
        ? before.gold - after.gold
        : null,
  };
  sameGold(before.gold, after.gold);
  if (
    current.floor !== original.floor ||
    current.target !== original.target ||
    current.hp !== original.hp ||
    current.maxHp !== original.maxHp
  ) {
    throw new Error("挑戰、樓層或怪血未保留。");
  }
  if (after.hp !== after.maxHp || after.mp !== after.maxMp) {
    throw new Error("未確認 HP／MP 已恢復至滿。");
  }
  run.result.state = "confirmed";
}

export async function moveTo(
  run: WorkflowRunner,
  world: Pick<WorldMap, "allRooms">,
  destination: number | string,
) {
  const before = await run.status();
  run.result.data.beforeStatus = before;
  if (
    run.scope &&
    run.store.get(run.scope.snapshotId).status.location !== before.location
  ) {
    throw new Error("起點已偏離準備快照，未重新規劃另一條路線。");
  }
  if (before.estimated) {
    throw new Error("需要已結算的金幣與位置。");
  }
  let room = await run.step("bears_look", {}, roomParser);
  if (room.inCombat || room.name !== before.location) {
    throw new Error("戰鬥中或現場位置不符。");
  }
  const rooms = await world.allRooms(run.signal);
  const starts = rooms.filter((entry) => entry.name === before.location);
  const targets = rooms.filter((entry) =>
    typeof destination === "number"
      ? entry.id === destination
      : entry.name === destination,
  );
  if (starts.length !== 1 || targets.length !== 1) {
    throw new Error("起點或目的地缺少／同名，不能唯一導航。");
  }
  const path = findRoomPath(rooms, starts[0], targets[0]);
  if (!path || targets[0].boss) {
    throw new Error("沒有已知的非 BOSS 步行路線。");
  }
  if (run.scope && path.length > run.scope.maxChanges) {
    throw new Error("路線超出本次步行範圍。");
  }
  const walked: { direction: string; room: string }[] = [];
  run.result.data = {
    ...run.result.data,
    planned: path.map((step) => ({
      direction: step.direction,
      room: step.room.name,
    })),
    walked,
    lastLocation: before.location,
  };
  for (const step of path) {
    if (
      !room.exits.includes(step.direction as Direction) ||
      room.inCombat ||
      /需要|消耗|門票|通行證/u.test(step.room.description)
    ) {
      throw new Error("出口、資格、費用或戰鬥狀態不允許下一步。");
    }
    await run.guard(run.result.sources.slice(-2));
    const arrived = await run.step(
      "bears_go",
      { direction: step.direction },
      (message) => {
        if (!message.text.includes(`你往${step.direction}走去`)) {
          return;
        }
        const parsed = roomFacts(message.text);
        return parsed?.name === step.room.name ? parsed : undefined;
      },
      true,
    );
    walked.push({ direction: step.direction, room: arrived.name });
    run.result.data.lastLocation = arrived.name;
    const status = await run.status();
    run.result.data.observedGoldSpend =
      before.gold !== null && status.gold !== null
        ? before.gold - status.gold
        : null;
    sameGold(before.gold, status.gold);
    if (status.location !== arrived.name) {
      throw new Error("實際目的地與角色狀態不符。");
    }
    room = await run.step("bears_look", {}, roomParser);
    if (room.name !== arrived.name || room.inCombat) {
      throw new Error("移動後現場位置或戰鬥狀態不符。");
    }
  }
  if (room.name !== targets[0].name) {
    throw new Error("未確認到達目的地。");
  }
  run.result.state = "confirmed";
}

export async function equipUpgrade(
  run: WorkflowRunner,
  equipment: EquipmentSnapshot,
  weights: EquipmentWeights,
) {
  const before = await run.status();
  run.result.data.beforeStatus = before;
  if (before.estimated) {
    throw new Error("掛機預估不能作換裝基準。");
  }
  const readInventory = () =>
    run.step("bears_inventory", { all: true }, (message) => {
      const inventory = run.store.inventory();
      return inventory?.value.complete &&
        inventory.sources.some((source) => source.messageId === message.id)
        ? inventory.value
        : undefined;
    });
  let inventory = await readInventory();
  let evaluation = equipment.evaluate(weights);
  const ids = [
    ...new Set(
      evaluation.blockers.flatMap((text) => {
        const match = /物品 (\d+) 缺少可綁定的 inspect/u.exec(text);
        return match ? [Number(match[1])] : [];
      }),
    ),
  ];
  for (const id of ids) {
    const item = inventory.entries.find((entry) => entry.id === id);
    if (
      !item ||
      inventory.entries.filter((entry) => entry.name === item.name).length !== 1
    ) {
      throw new Error("inspect 目標無法唯一綁定。");
    }
    await run.step("bears_inspect", { item: id }, (message) =>
      message.text.startsWith(`${item.name}\n類型：`) ? true : undefined,
    );
  }
  evaluation = equipment.evaluate(weights);
  run.result.data.evaluation = evaluation;
  if (!evaluation.applicable) {
    throw new Error(`配裝資料不足：${evaluation.blockers.join("；")}`);
  }
  const recommendation = evaluation.recommendations[0];
  if (!recommendation) {
    run.result.state = "confirmed";
    run.result.data.changed = false;
    return;
  }
  const original = requireValue(
    inventory.entries.find((item) => item.id === recommendation.targetId),
    "推薦目標不存在。",
  );
  const room = await run.step("bears_look", {}, roomParser);
  const equipFee = requireValue(room.equipFee, "換裝完整費用未知。");
  run.result.data.quotedGold = equipFee;
  if (
    room.inCombat ||
    equipFee > (run.scope?.maxGold ?? 0) ||
    before.gold === null ||
    before.gold < equipFee
  ) {
    throw new Error("換裝費用超出授權／餘額，或仍在戰鬥。");
  }
  // look 會使裝備快照失效，必須按原協定重新依序查詢本人狀態及全背包。
  const checkedStatus = await run.status();
  sameGold(before.gold, checkedStatus.gold);
  inventory = await readInventory();
  const current = equipment.evaluate(weights);
  const next = current.recommendations.find(
    (entry) => entry.slot === recommendation.slot,
  );
  if (
    !current.applicable ||
    !next ||
    next.targetId !== recommendation.targetId ||
    next.currentId !== recommendation.currentId ||
    next.delta <= 0
  ) {
    throw new Error("刷新後推薦／編號／現裝已改變，未換裝。");
  }
  const target = inventory.entries.find((item) => item.id === next.targetId);
  if (
    !target ||
    target.name !== original.name ||
    target.description !== original.description ||
    inventory.entries.filter((item) => item.name === target.name).length !== 1
  ) {
    throw new Error("目標名稱、屬性或唯一性已改變。");
  }
  await run.guard(run.result.sources.slice(-3));
  await run.step(
    "bears_equip",
    { item: next.targetId },
    (message) =>
      message.text.includes(target.name) &&
      /已裝備|裝備成功|穿上/u.test(message.text) &&
      !/無法|失敗/u.test(message.text)
        ? true
        : undefined,
    true,
  );
  await run.status();
  const after = await readInventory();
  run.result.data.beforeEquipment = evaluation.current;
  run.result.data.target = target;
  run.result.data.afterEquipment = after.entries.filter(
    (item) => item.equipped,
  );
  const worn = after.entries.filter(
    (item) =>
      item.name === target.name &&
      item.equipped &&
      item.description === target.description,
  );
  if (worn.length !== 1) {
    throw new Error("新背包未唯一確認目標已穿戴。");
  }
  const afterStatus = await run.status();
  run.result.data.observedGoldSpend =
    before.gold !== null && afterStatus.gold !== null
      ? before.gold - afterStatus.gold
      : null;
  if (run.result.data.observedGoldSpend !== equipFee) {
    throw new Error("換裝實際費用與已確認報價不符。");
  }
  run.result.data.changed = true;
  run.result.data.actualGold = equipFee;
  run.result.state = "confirmed";
}
