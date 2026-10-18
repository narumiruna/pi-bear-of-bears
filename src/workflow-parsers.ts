import { parseCharacterStatus } from "./character-status.js";
import type { GameMessage } from "./game.js";
import { plainGameText } from "./game-text.js";

export const WORKFLOW_QUERY =
  /^\/(?:status|look|tower|skills|home|inventory(?: all)?|inspect .+|forge(?: preview(?: \d+)?)?|refine|craft(?: [A-E][1-9][0-9]{0,18})?)$/u;
export const DIRECTIONS = ["北", "南", "東", "西", "上", "下"] as const;
export type Direction = (typeof DIRECTIONS)[number];
export const numberValue = (text: string | undefined): number | null => {
  if (!text || !/^(?:\d+|\d{1,3}(?:,\d{3})+)$/u.test(text)) {
    return null;
  }
  const value = Number(text.replaceAll(",", ""));
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
};
export const amount = (text: string, pattern: RegExp) =>
  numberValue(pattern.exec(text)?.[1]);
export const cleanName = (text: string) =>
  text.replace(/^[^\p{L}\p{N}]+/u, "").trim();

export function statusFacts(message: GameMessage) {
  if (!parseCharacterStatus(message)) {
    return;
  }
  const text = plainGameText(message.text);
  const title = text.split("\n")[0];
  const name = /^\S+\s+([\p{L}\p{N}_]+)\s+\S+\s+(?:二轉)?Lv\d+$/u.exec(
    title,
  )?.[1];
  const vitals = /^HP[：:]\s*(\d+)\/(\d+)\s+MP[：:]\s*(\d+)\/(\d+)/mu.exec(
    text,
  );
  const location = /^位置[：:]\s*(.+)$/mu.exec(text)?.[1];
  if (!name || !vitals || !location) {
    return;
  }
  if (
    [...text.matchAll(/^HP[：:]\s*\d+\/\d+\s+MP[：:]\s*\d+\/\d+/gmu)].length !==
      1 ||
    [...text.matchAll(/^\S+\s+[\p{L}\p{N}_]+\s+\S+\s+(?:二轉)?Lv\d+$/gmu)]
      .length !== 1
  ) {
    return;
  }
  const [hp, maxHp, mp, maxMp] = vitals.slice(1).map(Number);
  if (
    ![hp, maxHp, mp, maxMp].every(Number.isSafeInteger) ||
    hp > maxHp ||
    mp > maxMp ||
    maxHp < 1 ||
    maxMp < 0
  ) {
    return;
  }
  return {
    name,
    hp,
    maxHp,
    mp,
    maxMp,
    gold: amount(text, /^金幣[：:]\s*([\d,]+)/mu),
    estimated: /含掛機預估/u.test(text),
    location: cleanName(location),
    idle: /掛機中/u.test(text),
    attributes: Object.fromEntries(
      (["ATK", "DEF", "INT", "AGI"] as const).map((key) => [
        key,
        amount(text, new RegExp(`${key}[：:]\\s*([\\d,]+)`, "u")),
      ]),
    ),
  };
}

function startingFloors(text: string | undefined) {
  if (!text) {
    return [];
  }
  const values: number[] = [];
  for (const token of text.split(/[、,，]/u)) {
    const match = /^\s*(\d+)(?:\s*[-–~～]\s*(\d+))?\s*$/u.exec(token);
    if (!match) {
      return [];
    }
    const start = numberValue(match[1]),
      end = numberValue(match[2] ?? match[1]);
    if (
      start === null ||
      end === null ||
      start < 1 ||
      end < start ||
      end - start > 1000 ||
      values.length + end - start > 1000
    ) {
      return [];
    }
    for (let floor = start; floor <= end; floor++) {
      values.push(floor);
    }
  }
  return [...new Set(values)];
}

function fieldConflicts(text: string) {
  const conflicts: string[] = [];
  for (const [name, labels] of [
    ["樓層", "挑戰中(?:樓層)?|目前樓層"],
    ["怪血", "(?:怪物)?HP"],
    ["目標", "怪物|目標"],
    ["起始樓層", "可選起始樓層|起始樓層"],
    ["入場費", "入場費"],
  ]) {
    const values = [
      ...text.matchAll(new RegExp(`^(?:${labels})[：:]?\\s*(.+)$`, "gmu")),
    ].map((match) => match[1].trim());
    if (new Set(values).size > 1) {
      conflicts.push(`${name}有互相矛盾的欄位：${values.join("；")}`);
    }
  }
  return conflicts;
}

export function towerFacts(text: string) {
  const plain = plainGameText(text);
  if (
    !/^(?:無盡星塔|星塔狀態)(?:\s|$)/u.test(cleanName(plain.split("\n")[0]))
  ) {
    return;
  }
  const rawFloor = amount(
    plain,
    /^(?:挑戰中(?:樓層)?|目前樓層)[：:]?\s*第?(\d+)\s*層\s*$/mu,
  );
  const hp = /^(?:怪物)?HP[：:]\s*([\d,]+)\s*\/\s*([\d,]+)\s*$/mu.exec(plain);
  const conflicts = fieldConflicts(plain);
  const target =
    /^(?:怪物|目標)[：:]\s*(.+)$/mu.exec(plain)?.[1]?.trim() ?? null;
  const startText = /^(?:可選起始樓層|起始樓層)[：:]\s*(.+)$/mu.exec(
    plain,
  )?.[1];
  const floor = rawFloor !== null && rawFloor > 0 ? rawFloor : null;
  const starts = startingFloors(startText);
  const free = plain
    .split("\n")
    .map(cleanName)
    .some((line) =>
      /^(?:今日首戰免費|入場費[：:]\s*(?:今日首戰免費|免費|0\s*G))\s*[。！]?$/u.test(
        line,
      ),
    );
  const feeText = /^入場費[：:]\s*(.+)$/mu.exec(plain)?.[0] ?? "";
  const selectionConditions = plain
    .split("\n")
    .filter((line) => /^(?:自動擇一規則|擇一條件)[：:]/u.test(line));
  const selectionRule =
    selectionConditions.length === 1 &&
    /^(?:自動擇一規則|擇一條件)[：:]\s*碎晶足夠時優先使用碎晶，不足時改扣金幣[。！]?$/u.test(
      selectionConditions[0],
    )
      ? "crystals_first_then_gold"
      : null;
  const crystals = amount(feeText, /碎晶\s*[×x]\s*(\d+)/u);
  const gold = amount(feeText, /(?:或\s*|入場費[：:]\s*)([\d,]+)\s*G/u);
  const currentHp = numberValue(hp?.[1]);
  const maxHp = numberValue(hp?.[2]);
  const validHp =
    currentHp !== null && maxHp !== null && maxHp > 0 && currentHp <= maxHp;
  const freeConflict =
    free &&
    ((gold !== null && gold > 0) || (crystals !== null && crystals > 0));
  const verifiedFree = free && !freeConflict;
  const pricedFormat =
    /^入場費[：:]\s*(?:(?:星核)?碎晶\s*[×x]\s*\d+(?:\s*或\s*[\d,]+\s*G)?|[\d,]+\s*G)\s*(?:[（(]自動擇一[）)])?\s*$/u.test(
      feeText,
    );
  return {
    floor: conflicts.length > 0 ? null : floor,
    target: conflicts.length > 0 ? null : target,
    hp: validHp && conflicts.length === 0 ? currentHp : null,
    maxHp: validHp && conflicts.length === 0 ? maxHp : null,
    conflicts,
    attack: amount(plain, /ATK[：:]\s*([\d,]+)/u),
    best: amount(plain, /(?:個人最佳|最佳)[：:]?\s*(\d+)/u),
    starts,
    pricing: {
      kind:
        (!verifiedFree && !pricedFormat) ||
        freeConflict ||
        conflicts.length > 0 ||
        /另收|未含|不含|待定|未知/u.test(feeText)
          ? "unknown"
          : verifiedFree
            ? "free"
            : crystals !== null || gold !== null
              ? "paid"
              : "unknown",
      gold: verifiedFree ? 0 : gold,
      crystals: verifiedFree ? 0 : crystals,
      automaticChoice: /自動擇一/u.test(plain),
      selectionConditions,
      selectionRule,
      quote: feeText,
    },
    challengeKnown:
      floor !== null || /(?:目前沒有|尚未開始|未在)挑戰/u.test(plain),
    mechanics: plain
      .split("\n")
      .filter((line) => /特殊|狂暴|汲取|追傷|反傷|減傷|護盾/u.test(line)),
  };
}

export function roomFacts(text: string) {
  const plain = plainGameText(text);
  const exitsLine = /^.*🚪\s*出口[：:]\s*(.+)$/mu.exec(plain)?.[1];
  if (!exitsLine) {
    return;
  }
  const heading = plain
    .split("\n")
    .find(
      (line) =>
        line.trim() &&
        !/^(?:你往|你撕開回城卷軸|你啟動中繼傳送符|你握緊墜星碎片)/u.test(
          cleanName(line),
        ),
    );
  if (!heading || /^\s*🚪/u.test(heading)) {
    return;
  }
  const name = cleanName(heading.replace(/^📍\s*/u, ""));
  const exits = DIRECTIONS.filter((direction) =>
    new RegExp(
      `(?:^|[\\s、,，｜|])${direction}(?:$|[\\s、,，｜|（(:：]|→(?=[\\p{L}\\p{N}]))`,
      "u",
    ).test(exitsLine),
  );
  return {
    name,
    exits,
    freeRest:
      /(?:^|[；;，,\n])\s*(?:免費休息|免費恢復|\/rest[（(]免費[）)])\s*[。！]?(?:$|\n)/u.test(
        plain,
      ) && !/無法|不能|不可|不免費|付費休息|另收|未含|不含/u.test(plain),
    equipFee: /另收|未含|不含/u.test(plain)
      ? null
      : amount(plain, /^裝備費用[：:]\s*([\d,]+)\s*G\s*$/mu),
    inCombat: /戰鬥中|正在戰鬥/u.test(plain),
    restLocation: /安全|星塔前庭/u.test(plain),
  };
}

export function homeFacts(text: string) {
  const plain = plainGameText(text);
  if (
    !/^(?:家園|熊熊溫暖的家)(?:\s|$)/u.test(cleanName(plain.split("\n")[0]))
  ) {
    return;
  }
  return {
    vault: amount(plain, /金庫(?:餘額)?[：:]\s*([\d,]+)/u),
    cash: amount(plain, /身上(?:金幣)?[：:]\s*([\d,]+)/u),
    fee: /另收|未含|不含/u.test(plain)
      ? null
      : amount(plain, /^存款手續費[：:]\s*([\d,]+)\s*G\s*$/mu),
    canDeposit:
      /\/deposit\s+(?:金額|\d+)/u.test(plain) &&
      !/無法|不能|僅限|請先/u.test(plain),
  };
}

export function runtimeEffectFacts(text: string) {
  const effects: {
    kind: string;
    value: number;
    remainingHits: number | null;
    raw: string;
  }[] = [];
  for (const line of plainGameText(text).split("\n")) {
    const shield =
      /(?:接下來|接下來的)?\s*([1-9]\d*)\s*次受擊減傷\s*(\d+)%/u.exec(line);
    if (
      shield &&
      numberValue(shield[1]) !== null &&
      numberValue(shield[2]) !== null &&
      Number(shield[2]) <= 100
    ) {
      effects.push({
        kind: "damage_reduction",
        value: Number(shield[2]),
        remainingHits: Number(shield[1]),
        raw: line,
      });
    }
    const vulnerability = /易傷\s*(\d+)%/u.exec(line);
    if (vulnerability && numberValue(vulnerability[1]) !== null) {
      effects.push({
        kind: "vulnerability",
        value: Number(vulnerability[1]),
        remainingHits: null,
        raw: line,
      });
    }
    const dot = /DOT[：:]\s*(\d+)/u.exec(line);
    if (dot && numberValue(dot[1]) !== null) {
      effects.push({
        kind: "dot",
        value: Number(dot[1]),
        remainingHits: null,
        raw: line,
      });
    }
  }
  return effects.length > 0 ? effects : undefined;
}

export function skillsFacts(text: string) {
  const plain = plainGameText(text);
  if (
    !/^(?:技能列表|技能一覽|可用技能)(?:\s|$)/u.test(
      cleanName(plain.split("\n")[0]),
    ) ||
    !/MP/u.test(plain)
  ) {
    return;
  }
  const actions: {
    name: string;
    mpCost: number;
    hpCost: number | null;
    costsComplete: boolean;
    expectedDamage: number | null;
    available: boolean;
    description: string;
  }[] = [];
  for (const line of plain.split("\n")) {
    const match =
      /^(?:\d+[.、]\s*)?(?:[^\p{L}\p{N}]*)([\p{L}\p{N}·_]+)\s*[（(:：]\s*(\d+)\s*MP[）)]?(.*)$/u.exec(
        line.trim(),
      );
    if (!match) {
      continue;
    }
    const mpCost = numberValue(match[2]);
    if (mpCost === null) {
      continue;
    }
    const noOtherCosts = line
      .split(/[；;，,]/u)
      .some((part) => /^無其他成本[。！]?$/u.test(part.trim()));
    const explicitHp = amount(
      line,
      /(?:主動耗血|HP成本|HP消耗)[：:]\s*([\d,]+)\s*(?:HP)?(?=\s*(?:[；;，,。！]|$))/u,
    );
    const hpCost =
      explicitHp ??
      (noOtherCosts && !/HP|耗血|生命|血量/u.test(match[3]) ? 0 : null);
    const costsComplete =
      noOtherCosts &&
      hpCost !== null &&
      !/金幣|精魄|耗材|材料|次數限制|道具|額外|追加消耗|未含|不含|待驗證|未知|尚未/u.test(
        match[3],
      ) &&
      !/\d[\d,]*\s*G\b/u.test(match[3]);
    actions.push({
      name: match[1],
      mpCost,
      hpCost,
      costsComplete,
      expectedDamage: amount(line, /期望(?:傷害)?[：:]?\s*([\d,]+)/u),
      available: !/不可用|冷卻中/u.test(line),
      description: line,
    });
  }
  return actions.length > 0 ? actions : undefined;
}
