import {
  amount,
  type Checkpoint,
  homeFacts,
  roomFacts,
  skillsFacts,
  statusFacts,
  towerFacts,
  WORKFLOW_QUERY,
  type WorkflowObservations,
} from "./workflow-observations.js";
import { workflowResult } from "./workflow-result.js";

function quantities(point: Checkpoint, blockers: string[]) {
  if (!point.inventory?.complete) {
    blockers.push("前／後背包不完整，物品變化僅能部分核對。");
    return null;
  }
  const counts = new Map<string, number>();
  for (const item of point.inventory.entries) {
    if (counts.has(item.name)) {
      blockers.push(`同名物品無法唯一比較：${item.name}`);
      return null;
    }
    counts.set(item.name, item.count);
  }
  return counts;
}

export function reconcileRewards(
  store: WorkflowObservations,
  beforeId: string,
  afterId: string,
) {
  const before = store.get(beforeId),
    after = store.get(afterId);
  const result = workflowResult(after.actor, [
    ...before.sources,
    ...after.sources,
  ]);
  if (before.actor !== after.actor || before.endId >= after.endId) {
    throw new Error("對帳須為同角色、時間遞增的兩份快照。");
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
  const events: {
    source: number;
    revision: string;
    category: string;
    credit: number;
    debit: number;
  }[] = [];
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
      const fee = amount(text, /(?:存款手續費|手續費)[：:]\s*([\d,]+)\s*G/u);
      if (fee !== null) {
        events.push({
          source: record.message.id,
          revision: record.message.revision,
          category: "deposit_fee",
          credit: 0,
          debit: fee,
        });
      }
      continue;
    }
    if (record.command && WORKFLOW_QUERY.test(record.command)) {
      continue;
    }
    if (/預估|報價|需要|所需/u.test(text)) {
      continue;
    }
    const credit = amount(
      text,
      /(?:獲得金幣[：:]\s*|金幣\s*\+\s*)([\d,]+)\s*G?/u,
    );
    const total = amount(
      text,
      /(?:實際費用|實際支出|總支出)[：:]\s*([\d,]+)\s*G/u,
    );
    const base = amount(
      text,
      /(?:消耗金幣|花費金幣|金幣\s*-)[：:]?\s*([\d,]+)\s*G/u,
    );
    const tax = amount(text, /(?:稅費|手續費)[：:]\s*([\d,]+)\s*G/u);
    if (credit !== null || total !== null || base !== null || tax !== null) {
      const category = /首達|首次|寶箱/u.test(text)
        ? "one_time"
        : /掛機.*結算|掛機已結束/u.test(text)
          ? "idle_settled"
          : /入場/u.test(text)
            ? "entry"
            : /鍛造|精煉|合成/u.test(text)
              ? "upgrade"
              : "battle";
      events.push({
        source: record.message.id,
        revision: record.message.revision,
        category,
        credit: credit ?? 0,
        debit: total ?? (base ?? 0) + (tax ?? 0),
      });
    } else if (
      record.command ||
      !(
        statusFacts(record.message) ||
        towerFacts(text) ||
        roomFacts(text) ||
        homeFacts(text) ||
        skillsFacts(text) ||
        /^🎒 背包|^\s*\d+\. /u.test(text)
      )
    ) {
      result.blockers.push(`操作 ${record.message.id} 缺少可歸因的收支回執。`);
    }
  }
  let actualDelta: number | null = null;
  const cashBefore = before.status.gold,
    cashAfter = after.status.gold;
  if (cashBefore === null || cashAfter === null) {
    result.blockers.push("缺少前後實際金幣。");
  } else {
    actualDelta = cashAfter - cashBefore;
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
        actualDelta = null;
        result.blockers.push("存款區間缺少前後同角色金庫餘額。");
      } else {
        actualDelta += after.home.vault - before.home.vault;
      }
    }
  }
  const credits = events.reduce((sum, event) => sum + event.credit, 0),
    debits = events.reduce((sum, event) => sum + event.debit, 0);
  const safeTotals = [actualDelta, credits, debits].every(
    (value) => value === null || Number.isSafeInteger(value),
  );
  if (!safeTotals) {
    actualDelta = null;
    result.blockers.push("收支合計超過安全整數範圍，不能宣稱閉帳。");
  }
  const unexplained =
    actualDelta === null ? null : actualDelta - (credits - debits);
  if (unexplained !== 0) {
    result.blockers.push("金幣差額尚未閉合，不猜測漏發或稅率。");
  }
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
      result.blockers.push(
        `同名物品屬性已改變，不能只按數量比較：${previous.name}`,
      );
    }
  }
  const beforeItems = quantities(before, result.blockers),
    afterItems = quantities(after, result.blockers);
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
              event.category === "idle_settled",
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
    items,
    seconds,
    netGoldPerMinute:
      result.blockers.length === 0 && repeatable !== null
        ? (repeatable * 60) / seconds
        : null,
    note: "物品差額不代表逐項掉落歸因；未販售物品不計金幣價值。",
  };
  result.state = result.blockers.length > 0 ? "needs_observation" : "confirmed";
  return result;
}
