import { plainGameText } from "./game-text.js";
import { amount, cleanName, numberValue } from "./workflow-parser-values.js";

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
  // 776654：挑戰中回覆將樓層、目標與怪血放在同一行，沒有入場報價。
  const activeLines = plain
    .split("\n")
    .filter((line) => /^⚔️\s*挑戰中/u.test(line));
  const active = /^⚔️ 挑戰中：第 (\d+) 層　(.+?)　HP ([\d,]+)\/([\d,]+)$/u.exec(
    activeLines[0] ?? "",
  );
  const rawFloor = active
    ? numberValue(active[1])
    : amount(
        plain,
        /^(?:挑戰中(?:樓層)?|目前樓層)[：:]?\s*第?(\d+)\s*層\s*$/mu,
      );
  const hp = active
    ? [active[0], active[3], active[4]]
    : /^(?:怪物)?HP[：:]\s*([\d,]+)\s*\/\s*([\d,]+)\s*$/mu.exec(plain);
  const conflicts = fieldConflicts(plain);
  const target = active
    ? cleanName(active[2])
    : (/^(?:怪物|目標)[：:]\s*(.+)$/mu.exec(plain)?.[1]?.trim() ?? null);
  const startText = /^(?:可選起始樓層|起始樓層)[：:]\s*(.+)$/mu.exec(
    plain,
  )?.[1];
  const floor = rawFloor !== null && rawFloor > 0 ? rawFloor : null;
  const nativeFees = plain
    .split("\n")
    .filter((line) => /^🎫\s*入場[：:]/u.test(line));
  const nativeBest = plain
    .split("\n")
    .filter((line) => /^📜\s*個人最佳[：:]/u.test(line));
  const nativeStarts = plain.split("\n").filter((line) => /^\s*⏫/u.test(line));
  const nativeChallenge = plain
    .split("\n")
    .filter((line) => /^🚪\s*\/tower/u.test(line));
  const native =
    nativeFees.length +
      nativeBest.length +
      nativeStarts.length +
      nativeChallenge.length >
    0;
  const bestMatch = /^📜 個人最佳：第 (\d+) 層｜入塔 (\d+) 次$/u.exec(
    nativeBest[0] ?? "",
  );
  const startsMatch =
    /^\s*⏫ 想略過低樓？\/tower go (\d+)（可指定第 (\d+～\d+) 層起，直達你的挑戰前線）$/u.exec(
      nativeStarts[0] ?? "",
    );
  const challengeMatch =
    /^🚪 \/tower go 開始挑戰（自第 (\d+) 層起）——需站在 🗼星塔前庭$/u.exec(
      nativeChallenge[0] ?? "",
    );
  const nativeRange = startingFloors(startsMatch?.[2]);
  const positive = (value: string | undefined) => (numberValue(value) ?? 0) > 0;
  if (activeLines.length > 0) {
    if (
      activeLines.length !== 1 ||
      !active ||
      !target ||
      floor === null ||
      nativeBest.length !== 1 ||
      !bestMatch ||
      numberValue(bestMatch[1]) === null ||
      numberValue(bestMatch[2]) === null ||
      nativeFees.length > 0 ||
      nativeStarts.length > 0 ||
      nativeChallenge.length > 0 ||
      /^(?:挑戰中(?:樓層)?|目前樓層|怪物|目標|(?:怪物)?HP|個人最佳|最佳|入場費|可選起始樓層|起始樓層)[：:]/mu.test(
        plain,
      )
    ) {
      conflicts.push("原生目前挑戰缺漏、重複、混合其他欄位或未完整識別。");
    }
  }
  if (native && activeLines.length === 0) {
    if (nativeFees.length !== 1) {
      conflicts.push("原生入場費缺漏或重複。");
    }
    if (/^入場費[：:]/mu.test(plain)) {
      conflicts.push("入場費有重複來源。");
    }
    if (
      nativeBest.length !== 1 ||
      !bestMatch ||
      numberValue(bestMatch[1]) === null ||
      numberValue(bestMatch[2]) === null ||
      /^(?:個人最佳|最佳)[：:]/mu.test(plain)
    ) {
      conflicts.push("最佳欄位缺漏、重複或未完整識別。");
    }
    if (
      nativeStarts.length !== 1 ||
      !startsMatch ||
      nativeRange.length === 0 ||
      !positive(startsMatch[1]) ||
      !nativeRange.includes(Number(startsMatch[1])) ||
      startText !== undefined
    ) {
      conflicts.push("起始樓層缺漏、重複或未完整識別。");
    }
    if (
      nativeChallenge.length !== 1 ||
      !challengeMatch ||
      !positive(challengeMatch[1]) ||
      !nativeRange.includes(Number(challengeMatch[1]))
    ) {
      conflicts.push("原生挑戰入口未完整識別。");
    }
    if (
      plain
        .split("\n")
        .some(
          (line) =>
            /另收|未含|不含|限制|資格/u.test(line) ||
            (![
              ...nativeFees,
              ...nativeBest,
              ...nativeStarts,
              ...nativeChallenge,
            ].includes(line) &&
              /需|須|僅限|才可|手續費|稅|外加|額外|消耗|門票|費用|扣除/u.test(
                line,
              )),
        )
    ) {
      conflicts.push("原生入口有未核對的費用或資格限制。");
    }
  }
  const starts = native
    ? conflicts.some((value) => /起始樓層/u.test(value))
      ? []
      : nativeRange
    : startingFloors(startText);
  const free = plain
    .split("\n")
    .map(cleanName)
    .some((line) =>
      /^(?:今日首戰免費|入場費[：:]\s*(?:今日首戰免費|免費|0\s*G))\s*[。！]?$/u.test(
        line,
      ),
    );
  // quote 保留來源行，不以正規化後的標籤文字代替原文。
  const feeText =
    nativeFees[0] ?? /^入場費[：:]\s*(.+)$/mu.exec(plain)?.[0] ?? "";
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
  const nativePrice = /^🎫 入場：🌠碎晶×(\d+) 或 🪙([\d,]+)（自動擇一）$/u.exec(
    feeText,
  );
  const crystals = native
    ? numberValue(nativePrice?.[1])
    : amount(feeText, /碎晶\s*[×x]\s*(\d+)/u);
  const gold = native
    ? numberValue(nativePrice?.[2])
    : amount(feeText, /(?:或\s*|入場費[：:]\s*)([\d,]+)\s*G/u);
  const currentHp = numberValue(hp?.[1]);
  const maxHp = numberValue(hp?.[2]);
  const validHp =
    currentHp !== null && maxHp !== null && maxHp > 0 && currentHp <= maxHp;
  const nativeFree = native && /^🎫 入場：🎁 今日首戰免費$/u.test(feeText);
  const freeConflict =
    ((free || nativeFree) &&
      ((gold !== null && gold > 0) || (crystals !== null && crystals > 0))) ||
    (nativeFree && /今日首戰免費已(?:使用|用完|用)/u.test(plain));
  const verifiedFree =
    (native ? nativeFree : free) && !freeConflict && conflicts.length === 0;
  const pricedFormat = native
    ? nativePrice !== null && crystals !== null && gold !== null
    : /^入場費[：:]\s*(?:(?:星核)?碎晶\s*[×x]\s*\d+(?:\s*或\s*[\d,]+\s*G)?|[\d,]+\s*G)\s*(?:[（(]自動擇一[）)])?\s*$/u.test(
        feeText,
      );
  return {
    floor: conflicts.length > 0 ? null : floor,
    target: conflicts.length > 0 ? null : target,
    hp: validHp && conflicts.length === 0 ? currentHp : null,
    maxHp: validHp && conflicts.length === 0 ? maxHp : null,
    conflicts,
    attack: amount(plain, /ATK[：:]\s*([\d,]+)/u),
    best: native
      ? numberValue(bestMatch?.[1])
      : amount(plain, /(?:個人最佳|最佳)[：:]?\s*(\d+)/u),
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
      floor !== null ||
      (native && conflicts.length === 0 && challengeMatch !== null) ||
      /(?:目前沒有|尚未開始|未在)挑戰/u.test(plain),
    mechanics: plain
      .split("\n")
      .filter((line) => /特殊|狂暴|汲取|追傷|反傷|減傷|護盾/u.test(line)),
  };
}
