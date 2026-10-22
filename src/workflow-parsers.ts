import { parseCharacterStatus } from "./character-status.js";
import type { GameMessage } from "./game.js";
import { plainGameText } from "./game-text.js";

export const WORKFLOW_QUERY =
  /^\/(?:status|look|boss(?:_respawn)?|tower|skills|home|inventory(?: all)?|inspect .+|forge(?: preview(?: \d+)?)?|refine|craft(?: [A-E][1-9][0-9]{0,18})?)$/u;
export const DIRECTIONS = ["北", "南", "東", "西", "上", "下"] as const;
export type Direction = (typeof DIRECTIONS)[number];
export { amount, cleanName, numberValue } from "./workflow-parser-values.js";

import { amount, cleanName, numberValue } from "./workflow-parser-values.js";

export { towerFacts } from "./workflow-tower-parser.js";

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
  const wallets = [
    ...plain.matchAll(
      /^🐾 寵物 \d+\/\d+　🏦 金庫 ([\d,]+)G　身上 ([\d,]+)G$/gmu,
    ),
  ];
  const balance = (labeled: number | null, index: 1 | 2) => {
    const inline = numberValue(wallets[0]?.[index]);
    if (
      wallets.length > 1 ||
      (labeled !== null && inline !== null && labeled !== inline)
    ) {
      return null;
    }
    return labeled ?? inline;
  };
  return {
    vault: balance(amount(plain, /金庫(?:餘額)?[：:]\s*([\d,]+)/u), 1),
    cash: balance(amount(plain, /身上(?:金幣)?[：:]\s*([\d,]+)/u), 2),
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
    !/^(?:(?:技能列表|技能一覽|可用技能)(?:\s|$)|[\p{L}\p{N}·_]+\s+技能[（(]MP[：:]\s*\d+\/\d+[）)]$)/u.test(
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
  const lines = plain.split("\n");
  for (let index = 0; index < lines.length; index++) {
    let line = lines[index];
    let match =
      /^(?:\d+[.、]\s*)?(?:[^\p{L}\p{N}]*)([\p{L}\p{N}·_]+)\s*[（(:：]\s*(\d+)\s*MP[）)]?(.*)$/u.exec(
        line.trim(),
      );
    const command =
      /^\/skill\s+([\p{L}\p{N}·_]+)\s+MP[：:]\s*(\d+)\s*(.*)$/u.exec(
        line.trim(),
      );
    if (command) {
      while (
        index + 1 < lines.length &&
        /^\s+\S/u.test(lines[index + 1]) &&
        !/^\s*\/skill\s/u.test(lines[index + 1])
      ) {
        line += `\n${lines[++index]}`;
      }
      match = command;
    }
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
      (noOtherCosts && !/HP|耗血|生命|血量|燃燒/u.test(line) ? 0 : null);
    const costsComplete =
      noOtherCosts &&
      hpCost !== null &&
      !/金幣|精魄|耗材|材料|次數限制|道具|額外|追加消耗|未含|不含|待驗證|未知|尚未/u.test(
        line,
      ) &&
      !/\d[\d,]*\s*G\b/u.test(line);
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
