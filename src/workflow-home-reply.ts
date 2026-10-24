import { plainGameText } from "./game-text.js";
import { cleanName } from "./workflow-parser-values.js";

// native-home.json 與既有 replay 的行型；擴屋報價不是存款費用，未知家具格式不放寬。
const fields: [string[], RegExp][] = [
  [["cash"], /^身上金幣[：:]\s*[\d,]+$/u],
  [["vault"], /^金庫餘額[：:]\s*[\d,]+$/u],
  [["fee"], /^存款手續費[：:]\s*(?:[\d,]+G|未知)$/u],
  [["entry"], /^\/deposit (?:金額|\d+)$/u],
  [
    ["cash", "vault", "pets"],
    /^🐾 寵物 \d+\/\d+　🏦 金庫 [\d,]+G　身上 [\d,]+G$/u,
  ],
  [["collection"], /^🖼️ 珍藏 \d+ 件（無上限；牆上會掛出前排）$/u],
  [["furniture"], /^🪑 還沒買額外家具（客廳已有書架／窗／沙發／碗）。$/u],
  [["upgrade"], /^📦 下一級 Lv\d+：寵物上限 \d+、小屋變寬　費用 [\d,]+G$/u],
  [["upgrade_entry"], /^在家輸入 \/expand 或 \/home upgrade$/u],
];

/** 房間也可能名為「熊熊溫暖的家」；不可只用 cleanName 將 /look 誤當家園面板。 */
export function hasHomeReplyHeading(text: string) {
  const heading = plainGameText(text).split("\n")[0].trim();
  return /^(?:🏡\s*|家園(?:\s|$)|熊熊溫暖的家\s+房屋)/u.test(heading);
}

/** 搭配 homeFacts 的數值驗證；整份已知回覆不等於費用或入口齊全。 */
export function homeReplyComplete(text: string) {
  const body = plainGameText(text)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (
    body.length < 2 ||
    !/^(?:家園|熊熊溫暖的家\s+房屋 Lv\d+\/\d+)$/u.test(cleanName(body[0]))
  ) {
    return false;
  }
  const seen = new Set<string>();
  for (const line of body.slice(1)) {
    const field = fields.find(([, pattern]) => pattern.test(line));
    if (!field || field[0].some((key) => seen.has(key))) {
      return false;
    }
    for (const key of field[0]) {
      seen.add(key);
    }
  }
  return true;
}
