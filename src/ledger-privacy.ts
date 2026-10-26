import type { GameMessage } from "./game.js";
/** 只保存記帳所需引數；自由文字與聊天內容不進永久帳本。 */
export function ledgerCommand(command: string | null) {
  if (command === null) {
    return null;
  }
  const match = /^\/[a-z_]+(?:\s|$)/u.exec(command);
  if (!match || command.includes("\n") || command.length > 512) {
    return null;
  }
  const token = match[0].trim();
  // /skills 沒有已確認的引數協定；不能刪掉未知引數後冒充精確查詢。
  if (token === "/skills" && command !== token) {
    return null;
  }
  return /^\/(?:skill|tower|forge|refine|craft|deposit|equip|learn|evolve|inventory)(?:\s|$)/u.test(
    command,
  )
    ? command
    : token;
}
export function ledgerMessage(message: GameMessage): GameMessage {
  if (!message.outgoing) {
    return message;
  }
  const text = ledgerCommand(message.text) ?? "[未保存非記帳指令文字]";
  return { ...message, text, buttons: [] };
}
