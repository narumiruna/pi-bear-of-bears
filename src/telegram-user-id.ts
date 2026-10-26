/** Telegram TL long 保留為十進位字串，不經 JS Number 或角色名稱推定。 */
export function telegramUserId(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[1-9]\d{0,18}$/u.test(value) ||
    BigInt(value) > 9_223_372_036_854_775_807n
  ) {
    throw new Error("無法確認已登入的 Telegram 使用者本人 ID。");
  }
  return value;
}
export const telegramLedgerAccount = (id: unknown) =>
  `telegram-${telegramUserId(id)}`;
