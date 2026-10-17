import type { Codex } from "./codex.js";
import {
  type EquipmentWeights,
  equipmentScore,
} from "./equipment-optimizer.js";
import {
  parseInventoryEquipmentFacts,
  parseListedAttributes,
} from "./inventory.js";
import {
  amount,
  cleanName,
  type WorkflowObservations,
} from "./workflow-observations.js";
import { workflowResult } from "./workflow-result.js";

interface Material {
  name: string;
  quantity: number;
}
interface Recipe {
  name: string;
  materials: Material[];
  gold: number | null;
  essence: number | null;
  passive: string | null;
  stats: string | null;
  materialsComplete: boolean;
}

function parsePublicRecipe(raw: unknown): Recipe[] {
  const entry = raw as Record<string, unknown>;
  if (
    !entry ||
    typeof entry.out_name !== "string" ||
    !Array.isArray(entry.materials)
  ) {
    return [];
  }
  const materials = entry.materials.flatMap((value) => {
    const item = value as { name?: unknown; qty?: unknown };
    return item &&
      typeof item.name === "string" &&
      typeof item.qty === "number" &&
      Number.isSafeInteger(item.qty) &&
      item.qty > 0
      ? [{ name: item.name, quantity: item.qty }]
      : [];
  });
  return [
    {
      name: entry.out_name,
      materials,
      materialsComplete: materials.length === entry.materials.length,
      gold:
        typeof entry.gold === "number" &&
        Number.isSafeInteger(entry.gold) &&
        entry.gold >= 0
          ? entry.gold
          : null,
      essence:
        typeof entry.essence === "number" &&
        Number.isSafeInteger(entry.essence) &&
        entry.essence >= 0
          ? entry.essence
          : null,
      passive: typeof entry.out_passive === "string" ? entry.out_passive : null,
      stats: typeof entry.out_stats === "string" ? entry.out_stats : null,
    },
  ];
}

async function readRecipes(codex: Pick<Codex, "lookup">, signal?: AbortSignal) {
  const recipes: Recipe[] = [];
  let offset = 0;
  let version: string | null = null;
  let publicSource: {
    source: string;
    fetchedAt: string;
    total: number;
    nextOffset: number | null;
  } | null = null;
  while (true) {
    signal?.throwIfAborted();
    const page = await codex.lookup({ recipes: true, offset }, signal);
    if (version !== null && version !== page.fetchedAt) {
      throw new Error("公開配方分頁快照已改變。");
    }
    version = page.fetchedAt;
    publicSource = {
      source: page.source,
      fetchedAt: page.fetchedAt,
      total: page.total,
      nextOffset: page.nextOffset,
    };
    recipes.push(...page.entries.flatMap(parsePublicRecipe));
    if (page.nextOffset === null) {
      break;
    }
    if (
      !Number.isSafeInteger(page.nextOffset) ||
      page.nextOffset <= offset ||
      page.nextOffset >= page.total
    ) {
      throw new Error("公開配方分頁游標不合法。");
    }
    offset = page.nextOffset;
  }
  return { recipes, publicSource };
}

function publicCandidates(
  recipes: Recipe[],
  stock: Map<string, number>,
  protectedNames: Set<string>,
  publicSource: unknown,
  target: string,
) {
  const candidates: Record<string, unknown>[] = [];
  for (const recipe of recipes.filter((recipe) =>
    recipe.name.includes(target),
  )) {
    const remaining = new Map(stock),
      needed = new Map<string, number>(),
      issues: string[] = ["公開配方沒有完整含稅總額；不得直接付款。"];
    const path = new Set<string>();
    const stages = [
      { name: recipe.name, quantity: 1, quotedGold: recipe.gold },
    ];
    if (!recipe.materialsComplete || recipe.essence === null) {
      issues.push("配方材料／精魄需求有缺漏。");
    }
    const expand = (name: string, quantity: number) => {
      if (!Number.isSafeInteger(quantity) || quantity < 0) {
        issues.push(`材料數量溢位：${name}`);
        return;
      }
      if (path.has(name)) {
        issues.push(`配方循環：${name}`);
        return;
      }
      const held = remaining.get(name) ?? 0,
        used = Math.min(held, quantity);
      remaining.set(name, held - used);
      const missing = quantity - used;
      if (used > 0 && protectedNames.has(name)) {
        issues.push(`會消耗目前所需／鎖定材料：${name}`);
      }
      if (!missing) {
        return;
      }
      const matches = recipes.filter((entry) => entry.name === name);
      if (matches.length !== 1) {
        if (matches.length > 1) {
          issues.push(`子配方無法唯一選擇：${name}`);
        }
        const combined = (needed.get(name) ?? 0) + missing;
        if (!Number.isSafeInteger(combined)) {
          issues.push(`合計材料數量溢位：${name}`);
        } else {
          needed.set(name, combined);
        }
        return;
      }
      path.add(name);
      stages.push({ name, quantity: missing, quotedGold: matches[0].gold });
      if (!matches[0].materialsComplete || matches[0].essence === null) {
        issues.push(`配方材料／精魄缺漏：${name}`);
      }
      for (const material of matches[0].materials) {
        expand(material.name, material.quantity * missing);
      }
      if (matches[0].essence !== null) {
        expand("王之精魄", matches[0].essence * missing);
      }
      path.delete(name);
    };
    path.add(recipe.name);
    for (const material of recipe.materials) {
      expand(material.name, material.quantity);
    }
    if (recipe.essence !== null) {
      expand("王之精魄", recipe.essence);
    }
    const quotedStageGold = stages.every((stage) => stage.quotedGold !== null)
      ? stages.reduce(
          (sum, stage) => sum + (stage.quotedGold ?? 0) * stage.quantity,
          0,
        )
      : null;
    if (quotedStageGold !== null && !Number.isSafeInteger(quotedStageGold)) {
      issues.push("階段報價合計超過安全整數範圍。");
    }
    candidates.push({
      kind: "craft_public",
      target: recipe.name,
      quotedGold: recipe.gold,
      stages,
      quotedStageGold:
        quotedStageGold !== null && Number.isSafeInteger(quotedStageGold)
          ? quotedStageGold
          : null,
      totalGold: null,
      materials: recipe.materials,
      missing: [...needed].map(([name, quantity]) => ({ name, quantity })),
      stats: recipe.stats,
      passive: recipe.passive,
      issues,
      canPay: false,
      source: publicSource,
    });
  }
  return candidates;
}

function catalogueBlocks(text: string, command: string) {
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
  const stock = new Map<string, number>();
  const protectedNames = new Set<string>();
  for (const item of point.inventory.entries) {
    const name = cleanName(item.name);
    if (stock.has(name)) {
      result.blockers.push(`同名材料／裝備無法唯一綁定：${name}`);
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
  const candidates: Record<string, unknown>[] = [];
  for (const record of store.currentRecords(300_000)) {
    if (
      record.actor !== point.actor ||
      !/^\/(?:forge(?: preview(?: \d+)?)?|refine|craft)$/u.test(
        record.command ?? "",
      )
    ) {
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
    for (const block of blocks.filter((block) => block.includes(target))) {
      const materials: Material[] = [];
      for (const line of block.split("\n")) {
        const match = /^材料[：:]\s*(.+?)\s*[×x]\s*(\d+)$/u.exec(line.trim());
        if (match) {
          materials.push({
            name: cleanName(match[1]),
            quantity: Number(match[2]),
          });
        } else if (/^材料[：:]/u.test(line.trim())) {
          materials.push({ name: line.trim(), quantity: NaN });
        }
      }
      const quotedGold = amount(block, /(?:金幣|報價)[：:]\s*([\d,]+)\s*G/u);
      const total = amount(
        block,
        /^(?:含稅總額|完整總額)[：:]\s*([\d,]+)\s*G\s*$/mu,
      );
      const tax = amount(block, /^稅費[：:]\s*([\d,]+)\s*G\s*$/mu);
      const essence = amount(block, /精魄[：:]\s*(\d+)/u);
      if (essence !== null) {
        materials.push({ name: "王之精魄", quantity: essence });
      }
      const issues: string[] = [];
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
      if (
        record.command === "/craft" &&
        materials.some((item) => protectedNames.has(item.name))
      ) {
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
      let delta: number | null = null;
      if (
        metric === "attributes" &&
        facts &&
        stats &&
        ["attack", "defense", "intelligence", "agility"].every((key) =>
          Number.isFinite(stats[key as keyof EquipmentWeights]),
        )
      ) {
        delta =
          equipmentScore(stats as EquipmentWeights, weights) -
          equipmentScore(facts.stats, weights);
      } else {
        issues.push("沒有足夠證據計算所選指標的收益；未列屬性不補零。");
      }
      candidates.push({
        kind: record.command?.startsWith("/forge")
          ? "forge"
          : record.command === "/refine"
            ? "refine"
            : "craft",
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
        stage: /^階段[：:]\s*(.+)$/mu.exec(block)?.[1] ?? null,
        materials: deficits,
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
    publicSource,
    execution: "唯讀研究；缺價只阻擋相依候選，不執行強化、合成或取得材料。",
  };
  result.state = result.blockers.length > 0 ? "needs_observation" : "ready";
  return result;
}
