import type { EquipmentWeights } from "./equipment-optimizer.js";
import type { GameMessage } from "./game.js";

export interface InventoryEntry {
  id: number;
  name: string;
  count: number;
  equipped: boolean;
  description: string;
}

/** 僅解析已觀察到的單則清單；不將遊戲端省略或未知分頁視為完整。 */
export function parseInventory(message: GameMessage) {
  if (message.outgoing) return undefined;
  const lines = message.text.split(/\r?\n/);
  const header = /^🎒 背包（(\d+) 種）：$/.exec(lines[0]);
  if (!header) return undefined;
  const total = Number(header[1]);
  const entries: InventoryEntry[] = [];
  const diagnostics: string[] = [];
  for (const line of lines.slice(1)) {
    if (!/^\s*\d+\./.test(line)) continue;
    const match = /^\s*(\d+)\. (.+?)\s*—\s*(.+)$/.exec(line);
    if (!match) {
      diagnostics.push("無法解析物品列。");
      continue;
    }
    let name = match[2].trim();
    const equipped = name.includes("【裝備中】");
    name = name.replace("【裝備中】", "").trim();
    const count = / x(\d+)$/.exec(name);
    if (count) name = name.slice(0, count.index);
    entries.push({
      id: Number(match[1]),
      name,
      count: count ? Number(count[1]) : 1,
      equipped,
      description: match[3],
    });
  }
  if (!Number.isSafeInteger(total) || total < 0)
    diagnostics.push("宣告總數無效。");
  if (
    entries.some(
      (entry, index) =>
        entry.id !== index + 1 ||
        !Number.isSafeInteger(entry.count) ||
        entry.count < 1,
    )
  )
    diagnostics.push("編號不連續或數量無效。");
  if (entries.length !== total) diagnostics.push("宣告總數與已列物品數不同。");
  if (/未列出|另有|下一頁|第\s*\d+\s*頁/.test(message.text))
    diagnostics.push("遊戲端省略或分頁格式未支援。");
  if (!lines.some((line) => line.startsWith("🔢 用編號最方便：")))
    diagnostics.push("缺少已確認的清單結尾。");
  return {
    total,
    listed: entries.length,
    entries,
    diagnostics,
    complete: diagnostics.length === 0,
  };
}

export function parseListedAttributes(
  text: string,
): Partial<EquipmentWeights> | null {
  const aliases = {
    ATK: "attack",
    攻擊: "attack",
    DEF: "defense",
    防禦: "defense",
    INT: "intelligence",
    AGI: "agility",
    敏捷: "agility",
  } as const;
  const values: Partial<EquipmentWeights> = {};
  const pattern = /(ATK|DEF|INT|AGI|攻擊|防禦|敏捷)\s*([+-]\d+(?:\.\d+)?)/g;
  if (text.replace(pattern, "").replace(/[\s、,，]/g, "")) return null;
  for (const match of text.matchAll(pattern)) {
    const key = aliases[match[1] as keyof typeof aliases];
    if (values[key] !== undefined) return null;
    values[key] = Number(match[2]);
    if (!Number.isFinite(values[key])) return null;
  }
  return Object.keys(values).length ? values : null;
}

export function parseExplicitAttributes(text: string): EquipmentWeights | null {
  const values = parseListedAttributes(text);
  if (!values) return null;
  // 未列屬性不補零；強化加成重複列出時不擅自相加。
  if (
    ["attack", "defense", "intelligence", "agility"].some(
      (key) => !Number.isFinite(values[key as keyof EquipmentWeights]),
    )
  )
    return null;
  return values as EquipmentWeights;
}

/** inspect 保留描述及明確欄位；未列屬性不補零，未列效果不當成不存在。 */
export function parseInspect(message: GameMessage) {
  if (message.outgoing || !message.text.includes("\n類型：")) return undefined;
  const text = message.text;
  return {
    name: text.split(/\r?\n/)[0],
    kind:
      /^類型：(消耗品|材料)$/m.test(text) &&
      text.match(/^類型：/gm)?.length === 1
        ? "non-equipment"
        : "unknown",
    slot: /^類型：.*?（([^（）]+槽)）$/m.exec(text)?.[1] ?? null,
    eligible: /^需求等級：Lv\d+\s+✅ 可裝備（你 Lv\d+）$/m.test(text)
      ? true
      : null,
    requiredLevel: /^需求等級：Lv(\d+)/m.exec(text)?.[1] ?? null,
    attributes: /^屬性：(.+)$/m.exec(text)?.[1] ?? null,
    stats: parseExplicitAttributes(/^屬性：(.+)$/m.exec(text)?.[1] ?? ""),
    description: text,
    effects: null,
    unverifiedEffects: text
      .split(/\r?\n/)
      .filter((line) => /技能|被動|套裝|詞條|強化/.test(line)),
    diagnostics: [
      "完整技能／被動與未列屬性的語意尚未確認；不得據此產生可套用推薦。",
    ],
  };
}
