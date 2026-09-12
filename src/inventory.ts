import type { EquipmentWeights } from "./equipment-optimizer.js";
import type { GameMessage } from "./game.js";

export interface InventoryEntry {
  id: number;
  name: string;
  count: number;
  equipped: boolean;
  description: string;
}

export interface InventoryEquipmentFacts {
  slot: string;
  eligible: boolean;
  requiredLevel: number;
  stats: EquipmentWeights;
  inferredZeros: Array<keyof EquipmentWeights>;
  effects: string[];
}

const STANDARD_EQUIPMENT_SLOTS: readonly [RegExp, string][] = [
  [/(?:熊爪|巨劍|法杖|咒刃|戰斧)$/u, "武器槽"],
  [/護甲$/u, "身體槽"],
  [/頭盔$/u, "頭部槽"],
  [/護手$/u, "手部槽"],
  [/戰靴$/u, "腳部槽"],
  [/(?:護符|星環)$/u, "飾品槽"],
];

/**
 * 解析遊戲標準裝備列。只有名稱、屬性及等級尾碼全部符合已觀察格式時，
 * 才將未列的四軸屬性視為零；特殊名稱或額外效果文字仍交由 inspect。
 */
export function parseInventoryEquipmentFacts(
  entry: InventoryEntry,
): InventoryEquipmentFacts | undefined {
  const match = /^(.+?)（Lv(\d+) (可裝備|不可裝備)(?:・詞條裝)?）$/u.exec(
    entry.description,
  );
  if (!match) {
    return;
  }
  const listed = parseListedAttributes(match[1].trim());
  const slot = STANDARD_EQUIPMENT_SLOTS.find(([pattern]) =>
    pattern.test(entry.name),
  )?.[1];
  const requiredLevel = Number(match[2]);
  if (!listed || !slot || !Number.isSafeInteger(requiredLevel)) {
    return;
  }
  const stats: EquipmentWeights = {
    attack: listed.attack ?? 0,
    defense: listed.defense ?? 0,
    intelligence: listed.intelligence ?? 0,
    agility: listed.agility ?? 0,
  };
  return {
    slot,
    eligible: match[3] === "可裝備",
    requiredLevel,
    stats,
    inferredZeros: (
      ["attack", "defense", "intelligence", "agility"] as const
    ).filter((key) => listed[key] === undefined),
    effects: [],
  };
}

/** 只接受語意完整且不可能是裝備屬性的已觀察消耗品格式。 */
export function isExplicitNonEquipmentEntry(entry: InventoryEntry): boolean {
  return /^恢復 \d+ (?:HP|MP)$/u.test(entry.description);
}

/** 僅解析已觀察到的單則清單；不將遊戲端省略或未知分頁視為完整。 */
export function parseInventory(message: GameMessage) {
  if (message.outgoing) {
    return;
  }
  const lines = message.text.split(/\r?\n/);
  const header = /^🎒 背包（(\d+) 種(?:，全列)?）：$/.exec(lines[0]);
  if (!header) {
    return;
  }
  const total = Number(header[1]);
  const entries: InventoryEntry[] = [];
  const diagnostics: string[] = [];
  for (const line of lines.slice(1)) {
    if (
      !line.trim() ||
      line.startsWith("🔢 用編號最方便：") ||
      /^金幣：\d+ 🪙$/.test(line) ||
      line.startsWith("🔒 /lock 編號 ")
    ) {
      continue;
    }
    if (!/^\s*\d+\./.test(line)) {
      diagnostics.push("未知非編號行，無法確認背包完整性。");
      continue;
    }
    const match = /^\s*(\d+)\. (.+?)\s*—\s*(.+)$/.exec(line);
    if (!match) {
      diagnostics.push("無法解析物品列。");
      continue;
    }
    let name = match[2].trim();
    const equipped = name.includes("【裝備中】");
    name = name.replace("【裝備中】", "").trim();
    const count = / x(\d+)$/.exec(name);
    if (count) {
      name = name.slice(0, count.index);
    }
    entries.push({
      id: Number(match[1]),
      name,
      count: count ? Number(count[1]) : 1,
      equipped,
      description: match[3],
    });
  }
  if (!Number.isSafeInteger(total) || total < 0) {
    diagnostics.push("宣告總數無效。");
  }
  if (
    entries.some(
      (entry, index) =>
        entry.id !== index + 1 ||
        !Number.isSafeInteger(entry.count) ||
        entry.count < 1,
    )
  ) {
    diagnostics.push("編號不連續或數量無效。");
  }
  if (entries.length !== total) {
    diagnostics.push("宣告總數與已列物品數不同。");
  }
  if (/未列出|另有|下一頁|第\s*\d+\s*頁/.test(message.text)) {
    diagnostics.push("遊戲端省略或分頁格式未支援。");
  }
  if (!lines.some((line) => line.startsWith("🔢 用編號最方便："))) {
    diagnostics.push("缺少已確認的清單結尾。");
  }
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
  if (text.replace(pattern, "").replace(/[\s、,，]/g, "")) {
    return null;
  }
  for (const match of text.matchAll(pattern)) {
    const key = aliases[match[1] as keyof typeof aliases];
    if (values[key] !== undefined) {
      return null;
    }
    values[key] = Number(match[2]);
    if (!Number.isFinite(values[key])) {
      return null;
    }
  }
  return Object.keys(values).length > 0 ? values : null;
}

export function parseExplicitAttributes(text: string): EquipmentWeights | null {
  const values = parseListedAttributes(text);
  if (!values) {
    return null;
  }
  // 未列屬性不補零；強化加成重複列出時不擅自相加。
  if (
    ["attack", "defense", "intelligence", "agility"].some(
      (key) => !Number.isFinite(values[key as keyof EquipmentWeights]),
    )
  ) {
    return null;
  }
  return values as EquipmentWeights;
}

/** inspect 保留描述及明確欄位；未列屬性不補零，未列效果不當成不存在。 */
export function parseInspect(message: GameMessage) {
  if (message.outgoing || !message.text.includes("\n類型：")) {
    return;
  }
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
