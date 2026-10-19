import type { Codex } from "./codex.js";

export interface Material {
  name: string;
  quantity: number;
}
export interface Recipe {
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

export async function readRecipes(
  codex: Pick<Codex, "lookup">,
  signal?: AbortSignal,
) {
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

export function publicCandidates(
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
