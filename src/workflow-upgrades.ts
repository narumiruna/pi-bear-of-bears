import type { Codex } from "./codex.js";
import {
  type EquipmentWeights,
  equipmentScore,
} from "./equipment-optimizer.js";
import {
  parseInventoryEquipmentFacts,
  parseListedAttributes,
} from "./inventory.js";
import { upgradeComparison } from "./upgrade-comparison.js";
import { upgradeQuote, upgradeQuotePaths } from "./upgrade-quote.js";
import {
  type Material,
  publicCandidates,
  type Recipe,
  readRecipes,
} from "./upgrade-recipes.js";
import {
  amount,
  cleanName,
  type Source,
  WORKFLOW_QUERY,
  type WorkflowObservations,
} from "./workflow-observations.js";
import { workflowResult } from "./workflow-result.js";

function isUpgradeQuery(command: string) {
  return (
    /^\/(?:forge(?: preview(?: \d+)?)?|refine|craft)$/u.test(command) ||
    (command.startsWith("/craft ") && WORKFLOW_QUERY.test(command))
  );
}

function catalogueBlocks(text: string, command: string) {
  // 單一配方預覽須保留標題前後的消耗與警告，不依材料編號拆段。
  if (command.startsWith("/craft ") && WORKFLOW_QUERY.test(command)) {
    return [text];
  }
  const lines = text.split("\n");
  const blocks: string[] = [];
  let current = "";
  for (const line of lines) {
    if (/^\s*(?:\d+[.、]|[A-E]\d+[.、：:])/u.test(line)) {
      if (current) {
        blocks.push(current);
      }
      current = line;
    } else if (current) {
      current += `\n${line}`;
    }
  }
  if (current) {
    blocks.push(current);
  }
  if (blocks.length === 0 && /preview/u.test(command)) {
    blocks.push(text);
  }

  return blocks;
}

function materialDeficits(
  materials: Material[],
  stock: Map<string, number>,
  issues: string[],
) {
  const combined = new Map<string, number>();
  for (const item of materials) {
    const total = (combined.get(item.name) ?? 0) + item.quantity;
    if (!Number.isSafeInteger(total) || item.quantity < 0) {
      issues.push(`材料數量未知或溢位：${item.name}`);
      continue;
    }
    combined.set(item.name, total);
  }
  return [...combined].map(([name, quantity]) => ({
    name,
    quantity,
    held: stock.get(name) ?? 0,
    missing: Math.max(0, quantity - (stock.get(name) ?? 0)),
  }));
}

function menuMaterials(block: string): Material[] {
  return block.split("\n").flatMap((line) => {
    const match = /^材料[：:]\s*(.+?)\s*[×x]\s*(\d+)$/u.exec(line.trim());
    if (match) {
      return [{ name: cleanName(match[1]), quantity: Number(match[2]) }];
    }
    return /^材料[：:]/u.test(line.trim())
      ? [{ name: line.trim(), quantity: NaN }]
      : [];
  });
}

function craftPreviewFacts(block: string, stock: Map<string, number>) {
  const consumption = block
    .split("\n")
    .filter((line) => /將永久消耗[：:]/u.test(line));
  const warnings = block
    .split("\n")
    .filter((line) => /警告|確定燒絕世/u.test(line));
  const materials: Material[] = [];
  const issues = ["確認前須重新核對實際選材與保留用途；預覽不是消耗授權。"];
  // 只解析部署說明中的同列 ＋ 清單；其他格式保留原文與缺口。
  for (const line of consumption) {
    const list = line.split(/將永久消耗[：:]/u)[1];
    for (const value of list.split("＋")) {
      const match = /^(.+?)(?:\s*[×x]\s*([1-9]\d*))?$/u.exec(value.trim());
      materials.push({
        name: cleanName(match?.[1] ?? value),
        quantity: match ? Number(match[2] ?? 1) : NaN,
      });
    }
  }
  if (consumption.length !== 1) {
    issues.push("永久消耗清單缺漏或重複；須查閱原文。");
  }
  if (materials.some((item) => !stock.has(item.name))) {
    issues.push("選材名稱無法綁定本人背包；不推測品項或數量。");
  }
  const legendary = /絕世/u.test([...consumption, ...warnings].join("\n"));
  if (legendary) {
    issues.push("材料含絕世神裝；不得自動升級為確定燒絕世。");
  }
  return {
    materials,
    issues,
    metadata: {
      consumptionRaw: consumption,
      warnings,
      selectionVerified: false,
      confirmation: legendary
        ? "確定燒絕世"
        : consumption.length === 1
          ? "確定"
          : null,
    },
  };
}

function attributeDelta(
  metric: string,
  facts: ReturnType<typeof parseInventoryEquipmentFacts>,
  stats: ReturnType<typeof parseListedAttributes>,
  weights: EquipmentWeights,
) {
  if (
    metric !== "attributes" ||
    !facts ||
    !stats ||
    !["attack", "defense", "intelligence", "agility"].every((key) =>
      Number.isFinite(stats[key as keyof EquipmentWeights]),
    )
  ) {
    return null;
  }
  return (
    equipmentScore(stats as EquipmentWeights, weights) -
    equipmentScore(facts.stats, weights)
  );
}

function inventoryResources(
  entries: Parameters<typeof parseInventoryEquipmentFacts>[0][],
  blockers: string[],
) {
  const stock = new Map<string, number>();
  const protectedNames = new Set<string>();
  for (const item of entries) {
    const name = cleanName(item.name);
    if (stock.has(name)) {
      blockers.push(`同名材料／裝備無法唯一綁定：${name}`);
    }
    stock.set(name, item.count);
    if (
      item.equipped ||
      item.locked ||
      /技能|被動|套裝/u.test(item.description)
    ) {
      protectedNames.add(name);
    }
  }
  return { stock, protectedNames };
}

function appendSource(sources: Source[], source: Source) {
  if (
    !sources.some(
      (entry) =>
        entry.messageId === source.messageId &&
        entry.revision === source.revision,
    )
  ) {
    sources.push(structuredClone(source));
  }
}

export async function planUpgrade(
  store: WorkflowObservations,
  codex: Pick<Codex, "lookup">,
  options: {
    target: string;
    metric: "attributes" | "equipped_power" | "combat";
    weights: EquipmentWeights;
    signal?: AbortSignal;
  },
) {
  const { target, metric, weights, signal } = options;
  const point = store.capture();
  const result = workflowResult(point.actor, point.sources);
  if (!point.inventory?.complete || point.status.estimated) {
    result.blockers.push("需要本人新鮮完整背包與已結算狀態。");
    return result;
  }
  const { stock, protectedNames } = inventoryResources(
    point.inventory.entries,
    result.blockers,
  );
  let recipes: Recipe[] = [];
  let publicSource: unknown = null;
  try {
    const index = await readRecipes(codex, signal);
    recipes = index.recipes;
    publicSource = index.publicSource;
  } catch (error) {
    result.blockers.push(
      `公開配方來源暫不可用：${error instanceof Error ? error.message : String(error)}`,
    );
  }
  signal?.throwIfAborted();
  store.assertCurrent(point.id, point.actor, 300_000);
  const candidates: Record<string, unknown>[] = [];
  const pathStages: Parameters<typeof upgradeQuotePaths>[0] = [];
  for (const record of store.currentRecords(300_000)) {
    if (record.actor !== point.actor || !isUpgradeQuery(record.command ?? "")) {
      continue;
    }
    const age = Date.now() - record.message.date * 1000;
    if (age < 0 || age > 300_000) {
      continue;
    }
    const text = record.message.text;
    if (!text.includes(target)) {
      continue;
    }
    const blocks = catalogueBlocks(text, record.command ?? "");
    const contextRaw =
      blocks.length > 0 ? text.slice(0, text.indexOf(blocks[0])) : text;
    for (const block of blocks.filter((block) => block.includes(target))) {
      const isCraft = record.command?.startsWith("/craft") ?? false;
      const craft = isCraft ? craftPreviewFacts(block, stock) : null;
      const materials = craft?.metadata.consumptionRaw.length
        ? craft.materials
        : menuMaterials(block);
      const kind = record.command?.startsWith("/forge")
        ? "forge"
        : record.command === "/refine"
          ? "refine"
          : "craft";
      const quote = upgradeQuote(`${contextRaw}${block}`, kind, record.source);
      const quotedGold = quote.baseGold,
        total = quote.totalGold,
        tax = quote.taxGold;
      const essence =
        amount(block, /^精魄[：:]\s*(\d+)\s*$/mu) ??
        quote.native?.essence ??
        null;
      if (essence !== null) {
        materials.push({ name: "王之精魄", quantity: essence });
      }
      const issues: string[] = [...(craft?.issues ?? []), ...quote.issues];
      const deficits = materialDeficits(materials, stock, issues);
      if (/^精魄[：:]/mu.test(block) && essence === null) {
        issues.push("精魄需求未知。");
      }
      if (total === null) {
        issues.push("完整含稅成本未知。");
      }
      if (!/材料需求完整|無其他材料/u.test(block)) {
        issues.push("完整材料／選材尚未確認。");
      }
      if (/技能|被動|套裝/u.test(block)) {
        issues.push("效果取捨尚未完整比較。");
      }
      if (isCraft && materials.some((item) => protectedNames.has(item.name))) {
        issues.push("合成會消耗目前所需或鎖定的裝備／技能材料。");
      }
      if (total !== null && quotedGold !== null && total < quotedGold) {
        issues.push("總額小於報價，費用矛盾。");
      }
      const currentItem = point.inventory.entries.filter(
        (item) => cleanName(item.name) === target,
      );
      if (currentItem.length !== 1) {
        issues.push("本人目標持有狀態無法唯一確認。");
      }
      const facts =
        currentItem.length === 1
          ? parseInventoryEquipmentFacts(currentItem[0])
          : undefined;
      const stats = parseListedAttributes(
        /^進階後屬性[：:]\s*(.+)$/mu.exec(block)?.[1] ?? "",
      );
      const delta = attributeDelta(metric, facts, stats, weights);
      if (delta === null) {
        issues.push("沒有足夠證據計算所選指標的收益；未列屬性不補零。");
      }
      const stage =
        /^階段[：:]\s*(.+)$/mu.exec(block)?.[1] ?? quote.native?.stage ?? null;
      pathStages.push({ kind, target, stage, quote, materials });
      appendSource(result.sources, record.source);
      candidates.push({
        kind,
        quote: {
          ...quote,
          contextRaw,
          qualificationVerified: false,
        },
        comparison: upgradeComparison(
          currentItem.length === 1 ? currentItem[0] : undefined,
          block,
        ),
        target,
        source: record.source,
        quotedGold,
        tax,
        feeDifference:
          total !== null && quotedGold !== null ? total - quotedGold : null,
        totalGold: total,
        missingGold:
          total !== null && point.status.gold !== null
            ? Math.max(0, total - point.status.gold)
            : null,
        stage,
        materials: deficits,
        ...craft?.metadata,
        delta,
        issues,
        canPay: false,
        resourceScope: "候選各自比較，不能將同一份材料同時支用給多個候選。",
      });
    }
  }
  candidates.push(
    ...publicCandidates(recipes, stock, protectedNames, publicSource, target),
  );
  if (candidates.length === 0) {
    result.blockers.push("沒有可綁定的 forge／refine／craft 候選或配方。");
  }
  result.data = {
    snapshotId: point.id,
    target,
    metric,
    weights,
    candidates,
    quotePaths: upgradeQuotePaths(pathStages, stock, point.status.gold),
    publicSource,
    execution: "唯讀研究；缺價只阻擋相依候選，不執行強化、合成或取得材料。",
  };
  result.state = result.blockers.length > 0 ? "needs_observation" : "ready";
  return result;
}
