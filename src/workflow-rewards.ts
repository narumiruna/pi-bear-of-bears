import { nativeSkillBinding, parseCombatEvents } from "./combat-events.js";
import type { GameMessage } from "./game.js";
import { inventoryQuantities } from "./inventory-delta.js";
import { nativeForgeFacts } from "./upgrade-native.js";
import { goldReconciliation } from "./workflow-gold-reconciliation.js";
import {
  type Checkpoint,
  cleanName,
  WORKFLOW_QUERY,
  type WorkflowObservations,
} from "./workflow-observations.js";
import { knownQueryObservation } from "./workflow-query-observation.js";
import { workflowResult } from "./workflow-result.js";
import {
  idleRewardEvent,
  type RewardEvent,
  rewardLedger,
} from "./workflow-reward-ledger.js";
import {
  replayDepositFee,
  replayRewardEvent,
} from "./workflow-reward-replay.js";

function quantities(before: Checkpoint, after: Checkpoint, blockers: string[]) {
  if (!before.inventory?.complete || !after.inventory?.complete) {
    blockers.push("前／後背包不完整，物品變化僅能部分核對。");
    return {
      beforeItems: null,
      afterItems: null,
      ambiguousItems: [] as string[],
    };
  }
  const first = inventoryQuantities(before.inventory.entries);
  const last = inventoryQuantities(after.inventory.entries);
  const ambiguousItems = [...new Set([...first.ambiguous, ...last.ambiguous])];
  for (const name of ambiguousItems) {
    first.counts.delete(name);
    last.counts.delete(name);
    blockers.push(`同名物品無法唯一比較：${name}`);
  }
  return { beforeItems: first.counts, afterItems: last.counts, ambiguousItems };
}

function appendForgeReceipt(
  message: GameMessage,
  events: RewardEvent[],
  consumed: Map<string, number>,
  blockers: string[],
) {
  const receipt = nativeForgeFacts(message.text);
  if (
    !receipt ||
    receipt.receiptTotalGold === null ||
    receipt.essence === null ||
    !receipt.from ||
    !receipt.to
  ) {
    blockers.push(`鍛造 ${message.id} 的完整回執未確認；不以選單價補值。`);
    return;
  }
  events.push({
    source: message.id,
    revision: message.revision,
    category: "upgrade",
    credit: 0,
    debit: receipt.receiptTotalGold,
  });
  for (const [name, quantity] of [
    ["王之精魄", receipt.essence],
    [receipt.from, 1],
    [receipt.to, -1],
  ] as const) {
    const total = (consumed.get(name) ?? 0) + quantity;
    if (!Number.isSafeInteger(total)) {
      blockers.push(`品項收支合計超過安全整數範圍：${name}`);
    }
    consumed.set(name, total);
  }
}

function verifyConsumedMaterials(
  before: Map<string, number> | null,
  after: Map<string, number> | null,
  consumed: Map<string, number>,
  blockers: string[],
) {
  for (const [name, quantity] of consumed) {
    const first = [...(before ?? [])].filter(
      ([key]) => cleanName(key) === name,
    );
    const last = [...(after ?? [])].filter(([key]) => cleanName(key) === name);
    if (
      !before ||
      !after ||
      first.length > 1 ||
      last.length > 1 ||
      (first[0]?.[1] ?? 0) - (last[0]?.[1] ?? 0) !== quantity
    ) {
      blockers.push(`明列消耗與完整背包差額不閉合：${name}`);
    }
  }
}

function verifyForgeWear(
  before: Checkpoint,
  after: Checkpoint,
  messages: GameMessage[],
  blockers: string[],
) {
  const evolutions = new Map<string, string>();
  for (const message of messages) {
    if (message.outgoing || !message.text.startsWith("🔨✨ 進階成功！")) {
      continue;
    }
    const receipt = nativeForgeFacts(message.text);
    if (
      receipt &&
      receipt.receiptTotalGold !== null &&
      receipt.from &&
      receipt.to
    ) {
      evolutions.set(receipt.from, receipt.to);
    }
  }
  const expected = (before.inventory?.entries ?? [])
    .filter((item) => item.equipped)
    .map((item) => {
      let name = cleanName(item.name);
      // 支援同一對帳區間的兩階演進；不是後端物品 ID 或自動換裝許可。
      for (let count = 0; count < evolutions.size; count++) {
        name = evolutions.get(name) ?? name;
      }
      return name;
    })
    .sort();
  const actual = (after.inventory?.entries ?? [])
    .filter((item) => item.equipped)
    .map((item) => cleanName(item.name))
    .sort();
  if (JSON.stringify(expected) !== JSON.stringify(actual)) {
    blockers.push(
      "鍛造前後穿戴改變超出品項演進；自動換裝未確認，不交付下一階許可。",
    );
  }
}

function verifyForgeInventory(
  context: {
    before: Checkpoint;
    after: Checkpoint;
    beforeItems: Map<string, number> | null;
    afterItems: Map<string, number> | null;
    consumed: Map<string, number>;
    messages: GameMessage[];
  },
  blockers: string[],
) {
  const { before, after, beforeItems, afterItems, consumed, messages } =
    context;
  if (consumed.size === 0 || !beforeItems || !afterItems) {
    return;
  }
  verifyForgeWear(before, after, messages, blockers);
  for (const [name, quantity] of beforeItems) {
    if (
      (afterItems.get(name) ?? 0) < quantity &&
      !consumed.has(cleanName(name))
    ) {
      blockers.push(`鍛造區間有未列消耗或原裝遺失：${name}`);
    }
  }
}

function verifyItemAttributes(
  before: Checkpoint,
  after: Checkpoint,
  blockers: string[],
) {
  for (const previous of before.inventory?.entries ?? []) {
    const current = after.inventory?.entries.filter(
      (item) => item.name === previous.name,
    );
    if (
      current?.length === 1 &&
      (current[0].description !== previous.description ||
        JSON.stringify(current[0].refinement) !==
          JSON.stringify(previous.refinement))
    ) {
      blockers.push(`同名物品屬性已改變，不能只按數量比較：${previous.name}`);
    }
  }
}

export function reconcileRewards(
  store: WorkflowObservations,
  beforeId: string,
  afterId: string,
  historical = false,
) {
  const before =
      historical === true ? store.historical(beforeId) : store.get(beforeId),
    after =
      historical === true ? store.historical(afterId) : store.get(afterId);
  const result = workflowResult(after.actor, [
    ...before.sources,
    ...after.sources,
  ]);
  if (
    before.actor !== after.actor ||
    before.epoch !== after.epoch ||
    before.endId >= after.endId
  ) {
    throw new Error("對帳須為同角色、同控制情境且時間遞增的兩份快照。");
  }
  if (before.coverage !== after.coverage) {
    result.blockers.push(
      "區間有 watch 缺頁，重新取得當前餘額不能補回遺失的收支證據。",
    );
  }
  if (before.status.estimated || after.status.estimated) {
    result.blockers.push("餘額包含掛機預估，不當成已結算收益。");
  }
  const interval = store
    .all()
    .filter(
      (record) =>
        record.message.id > before.endId && record.message.id <= after.endId,
    );
  const events: RewardEvent[] = [];
  const consumed = new Map<string, number>();
  let deposit = false;
  for (const record of interval) {
    if (record.actor !== after.actor) {
      result.blockers.push("區間含身分不明或其他角色活動。");
      continue;
    }
    if (record.message.outgoing) {
      continue;
    }
    const text = record.message.text;
    if (
      record.command?.startsWith("/deposit") ||
      /存入.*金庫|存款成功/u.test(text)
    ) {
      deposit = true;
      const fee = replayDepositFee(record);
      if (fee) {
        events.push(fee);
      } else {
        result.blockers.push(
          `存款 ${record.message.id} 缺少綁定相同金額且完整明列費用的回執。`,
        );
      }
      continue;
    }
    if (
      record.command === "/idlestatus" ||
      (record.command && WORKFLOW_QUERY.test(record.command))
    ) {
      continue;
    }
    const idle = idleRewardEvent(record, after.actor);
    if (idle) {
      events.push(idle);
      continue;
    }
    if (text.startsWith("🔨✨ 進階成功！")) {
      appendForgeReceipt(record.message, events, consumed, result.blockers);
      continue;
    }
    if (
      /預估|報價|需要|所需/u.test(text) &&
      !/^(?:戰鬥紀錄：|✨ 使用技能：)/u.test(text)
    ) {
      continue;
    }
    if (/^(?:戰鬥紀錄：|✨ 使用技能：)/u.test(text)) {
      const combat = parseCombatEvents(text, record.source);
      if (
        combat.outcome !== "won" ||
        combat.rewardGold.value === null ||
        nativeSkillBinding(combat, record.command)?.requestMatches === false
      ) {
        result.blockers.push(
          `戰鬥 ${record.message.id} 未正式完整結算，不計金幣。`,
        );
      } else {
        events.push({
          source: record.message.id,
          revision: record.message.revision,
          category: "battle",
          credit: combat.rewardGold.value,
          debit: 0,
        });
      }
      continue;
    }
    const replay = replayRewardEvent(record, result.blockers);
    if (replay) {
      events.push(replay);
    } else if (record.command || !knownQueryObservation(record.message)) {
      result.blockers.push(`操作 ${record.message.id} 缺少可歸因的收支回執。`);
    }
  }
  let actual: bigint | null = null;
  const cashBefore = before.status.gold,
    cashAfter = after.status.gold;
  if (cashBefore === null || cashAfter === null) {
    result.blockers.push("缺少前後實際金幣。");
  } else {
    actual = BigInt(cashAfter) - BigInt(cashBefore);
    if (deposit) {
      if (before.home?.cash !== cashBefore || after.home?.cash !== cashAfter) {
        result.blockers.push("存款區間的身上／家園現金證據不一致或缺漏。");
      }
      if (
        before.home?.vault === null ||
        before.home?.vault === undefined ||
        after.home?.vault === null ||
        after.home?.vault === undefined
      ) {
        actual = null;
        result.blockers.push("存款區間缺少前後同角色金庫餘額。");
      } else {
        actual += BigInt(after.home.vault) - BigInt(before.home.vault);
      }
    }
  }
  const totals = goldReconciliation(actual, events);
  const { actualDelta, credits, debits, unexplained } = totals;
  if (
    totals.overflow.actualDelta ||
    totals.overflow.credits ||
    totals.overflow.debits
  ) {
    result.blockers.push("收支合計超過安全整數範圍，不能宣稱閉帳。");
  }
  if (totals.overflow.unexplained) {
    result.blockers.push("待歸因差額超過安全整數範圍，不提供不可靠的差額。");
  }
  if (unexplained !== 0) {
    result.blockers.push("金幣差額尚未閉合，不猜測漏發或稅率。");
  }
  verifyItemAttributes(before, after, result.blockers);
  const { beforeItems, afterItems, ambiguousItems } = quantities(
    before,
    after,
    result.blockers,
  );
  verifyConsumedMaterials(beforeItems, afterItems, consumed, result.blockers);
  verifyForgeInventory(
    {
      before,
      after,
      beforeItems,
      afterItems,
      consumed,
      messages: interval.map((record) => record.message),
    },
    result.blockers,
  );
  const items =
    beforeItems && afterItems
      ? [...new Set([...beforeItems.keys(), ...afterItems.keys()])]
          .map((name) => ({
            name,
            before: beforeItems.get(name) ?? 0,
            after: afterItems.get(name) ?? 0,
            delta: (afterItems.get(name) ?? 0) - (beforeItems.get(name) ?? 0),
          }))
          .filter((item) => item.delta !== 0)
      : null;
  const seconds = after.sources[0].date - before.sources[0].date;
  if (seconds <= 0) {
    result.blockers.push("缺少正的完整經過時間。");
  }
  const net = actualDelta;
  const repeatable =
    net === null
      ? null
      : net -
        events
          .filter(
            (event) =>
              event.category === "one_time" ||
              event.category === "idle_settled" ||
              event.category === "idle_manual" ||
              event.category === "idle_natural",
          )
          .reduce((sum, event) => sum + event.credit - event.debit, 0);
  result.data = {
    beforeId,
    afterId,
    actualDelta,
    credits,
    debits,
    unexplained,
    events,
    consumedMaterials: [...consumed]
      .filter(([, quantity]) => quantity > 0)
      .map(([name, quantity]) => ({ name, quantity })),
    expectedItemDeltas: [...consumed].map(([name, quantity]) => ({
      name,
      delta: -quantity,
    })),
    items,
    ambiguousItems,
    seconds,
    netGoldPerMinute:
      result.blockers.length === 0 && repeatable !== null
        ? (repeatable * 60) / seconds
        : null,
    ledger: rewardLedger(events, interval, before, after, {
      actualDelta,
      unexplained,
      blockers: result.blockers,
    }),
    note: "物品差額不代表逐項掉落歸因；未販售物品不計金幣價值。",
  };
  if (totals.hasOverflow) {
    result.data.exactGold = totals.exact;
  }
  if (historical === true) {
    const currentCharacter = store.status()?.value.name ?? null;
    result.data.actionable = false;
    result.data.historicalContext = {
      currentCharacter,
      intervalCharacter: after.actor,
      currentGeneration: store.generation,
      intervalGeneration: after.epoch,
      sameControlContext:
        currentCharacter === after.actor && store.generation === after.epoch,
      sourceTimesRefreshed: false,
      budgetEligible: false,
      note: "僅本分支保存的歷史區間，不是目前餘額、預算或操作資格；執行型快照仍須目前控制情境及新觀測。",
    };
  }
  result.state = result.blockers.length > 0 ? "needs_observation" : "confirmed";
  return result;
}
