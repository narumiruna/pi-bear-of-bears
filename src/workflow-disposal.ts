import { parseInspect } from "./inventory.js";
import { inventoryDifferences } from "./inventory-delta.js";
import {
  cleanName,
  type WorkflowObservations,
} from "./workflow-observations.js";
import { workflowResult } from "./workflow-result.js";

export interface DisposalCandidate {
  snapshotId: string;
  item: string;
  quantity: 1;
  retain?: number;
  verifyAfter?: string;
  inspect?: { messageId: number; revision: string };
  preview?: { messageId: number; revision: string };
}

function disposalAfterCheck(
  store: WorkflowObservations,
  input: DisposalCandidate,
) {
  const before = store.get(input.snapshotId);
  const after = store.get(input.verifyAfter as string);
  const comparison = inventoryDifferences(before, after);
  const result = workflowResult(after.actor, [
    ...before.sources,
    ...after.sources,
  ]);
  const targets =
    before.inventory?.entries.filter(
      (entry) => cleanName(entry.name) === cleanName(input.item),
    ) ?? [];
  const change = comparison.changes.filter(
    (item) => cleanName(item.name) === cleanName(input.item),
  );
  const quantityMatches =
    targets.length === 1 &&
    change.length === 1 &&
    change[0].delta === -input.quantity &&
    !comparison.ambiguous.some(
      (name) => cleanName(name) === cleanName(input.item),
    );
  if (!quantityMatches) {
    result.blockers.push(
      "物品數量差額與單件候選不符或名稱有歧義，停止後續相依操作。",
    );
  }
  result.blockers.push(
    "分解預覽的單件收益尚未驗證，不能以碎片增加冒稱驗收通過。",
  );
  result.data = {
    actionable: false,
    quantityMatchesDeclaration: quantityMatches,
    comparison,
    expectedFragments: null,
    fragmentsVerified: false,
    authorizationGranted: false,
  };
  return result;
}

/** 唯讀候選預檢；不含任何分解、付款或升級呼叫。
 * native preview 尚缺完整 fixture，不能以 caller 提供的數字或日誌摘要解鎖。
 */
export function disposalPreflight(
  store: WorkflowObservations,
  input: DisposalCandidate,
) {
  const result = workflowResult();
  result.data = {
    actionable: false,
    authorizationGranted: false,
    candidate: input,
    numericIndexRisk: "數字會整組分解；此預檢不產生數字或批次指令。",
    expectedFragments: null,
    usesComplete: false,
  };
  if (
    /^\d+$/u.test(input.item) ||
    input.quantity !== 1 ||
    /^(?:全部|>)/u.test(input.item)
  ) {
    result.blockers.push(
      "只接受唯一完整名稱的單件候選，不接受整組數字或批次入口。",
    );
    return result;
  }
  if (input.verifyAfter) {
    return disposalAfterCheck(store, input);
  }
  const point = store.get(input.snapshotId);
  result.actor = point.actor;
  result.sources.push(...point.sources);
  store.assertCurrent(input.snapshotId, point.actor, 300_000, [
    "status",
    "inventory",
  ]);
  if (!point.inventory?.complete) {
    result.blockers.push("候選必須綁定完整背包版本。");
    return result;
  }
  const matches = point.inventory.entries.filter(
    (entry) => cleanName(entry.name) === cleanName(input.item),
  );
  if (matches.length !== 1) {
    result.blockers.push("同名多組、名稱歧義或物品不存在；不改用另一列號。");
    return result;
  }
  const item = matches[0];
  result.data.item = item;
  result.data.inventoryVersion = point.id;
  result.data.permanentlyLost = {
    name: item.name,
    quantity: 1,
    refinement: item.refinement ?? null,
  };
  if (item.equipped || item.locked) {
    result.blockers.push("穿戴中或已鎖定，不給處置推薦。");
  }
  if (
    input.retain === undefined ||
    !Number.isSafeInteger(input.retain) ||
    input.retain < 0
  ) {
    result.blockers.push("保留量及必要用途尚未確認。");
  } else if (item.count - 1 < input.retain || item.count <= 1) {
    result.blockers.push(
      "低於宣告保留量或將失去最後一件；預檢不自動犧牲最後一件。",
    );
  }
  const evidence = (
    ref: DisposalCandidate["inspect"],
    kind: "inspect" | "preview",
  ) => {
    const record =
      ref &&
      store
        .all()
        .find(
          (record) =>
            record.message.id === ref.messageId &&
            record.message.revision === ref.revision,
        );
    if (
      !record ||
      record.message.outgoing ||
      record.actor !== point.actor ||
      record.epoch !== point.epoch ||
      Date.now() < record.source.observedAt ||
      Date.now() < record.source.date * 1000 ||
      Date.now() - record.source.date * 1000 > 300_000
    ) {
      result.blockers.push(`${kind} 缺少同角色新鮮、未修訂的來源。`);
      return null;
    }
    result.sources.push(record.source);
    return record;
  };
  const inspect = evidence(input.inspect, "inspect");
  const parsed = inspect ? parseInspect(inspect.message) : null;
  const inventoryEnd = Math.max(
    ...point.sources
      .filter((source) => store.channel(source) === "inventory")
      .map((source) => source.messageId),
  );
  if (
    !inspect ||
    !parsed ||
    cleanName(parsed.name) !== cleanName(item.name) ||
    inspect.message.id <= inventoryEnd ||
    inspect.command !== `/inspect ${item.id}`
  ) {
    result.blockers.push(
      "inspect 未綁定此完整版本的唯一名稱及列號；不沿用重編號前查驗。",
    );
  } else {
    result.data.inspection = parsed;
  }
  const preview = evidence(input.preview, "preview");
  if (preview?.command !== "/dismantle") {
    result.blockers.push("缺少可綁定的分解清單預覽。");
  } else if (preview.message.id <= inventoryEnd) {
    result.blockers.push("分解預覽早於綁定背包版本，不能沿用舊品項或舊編號。");
  }
  result.blockers.push(
    "完整 native 分解預覽格式與單件收益尚未驗證，預期碎片保持未知。",
    "必要裝備、授技、被動及合成保留用途須另行核對；不按低屬性判廢品。",
    "預檢不是操作授權；不得串接付款、分解或升級。",
  );
  return result;
}
