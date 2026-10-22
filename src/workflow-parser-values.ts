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
