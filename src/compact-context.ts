const LINE_BREAK_PATTERN = /\r?\n/;
const DIVIDER_PATTERN = /^\s*[─━═]{3,}\s*$/;
const DECORATION_PATTERN =
  /(?:🌀(?=閃\d+(?:\.\d+)?%)|⚡(?=連\d+(?:\.\d+)?%)|💥(?=暴\d+(?:\.\d+)?%)|🐾[ \t]*(?=掛機中))/gu;
const PROGRESS_BAR_PATTERN = /(?<=Lv\d+ )[▰▱█░▓]+ (?=\d+(?:\.\d+)?%)/gu;

// 僅移除已有文字或數值表達相同意義的裝飾，不推測遊戲語意。
function compactGameText(text: string): string {
  return text
    .split(LINE_BREAK_PATTERN)
    .filter((line) => !DIVIDER_PATTERN.test(line))
    .map((line) =>
      line.replace(DECORATION_PATTERN, "").replace(PROGRESS_BAR_PATTERN, ""),
    )
    .filter((line) => line.trim() !== "")
    .join("\n");
}

function compactValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(compactValue);
  }
  if (value === null || typeof value !== "object") {
    return value;
  }
  const object = value as Record<string, unknown>;
  // 只處理已辨識的 bot 訊息本文；送出的指令、按鈕及未知欄位保持原樣。
  const isBotMessage =
    object.outgoing === false &&
    typeof object.id === "number" &&
    typeof object.revision === "string" &&
    Array.isArray(object.buttons);
  return Object.fromEntries(
    Object.entries(object).map(([key, child]) => {
      if (isBotMessage && key === "text" && typeof child === "string") {
        return [key, compactGameText(child)];
      }
      return [key, compactValue(child)];
    }),
  );
}

function compactBearsOutput(text: string): string {
  try {
    // JSON 以外的錯誤或截斷輸出原樣保留，包含完整輸出的私人路徑。
    return JSON.stringify(compactValue(JSON.parse(text)));
  } catch {
    return text;
  }
}

export { compactBearsOutput, compactGameText };
