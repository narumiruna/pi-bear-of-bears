import { parseNativeCombat } from "./combat-native.js";
import type { GameMessage } from "./game.js";
import { plainGameText } from "./game-text.js";
import type { Source } from "./workflow-observation-types.js";
import { runtimeEffectFacts } from "./workflow-parsers.js";

/** 局部效果可供研究，但不能單獨使整份訊息成為可信技能回覆。
 * 原生格式須整份解析且技能名稱與本次 request 相同；標籤式 replay 只容許完整效果行。
 * 不以先前殘留的 outgoing /skill 推定晚到訊息的角色或操作歸屬。
 */
export function runtimeEffectReplyFacts(
  message: GameMessage,
  request: string | null | undefined,
  source: Source,
) {
  if (message.outgoing || !request?.startsWith("/skill ")) {
    return;
  }
  const text = plainGameText(message.text.replaceAll("\r\n", "\n"));
  const effects = runtimeEffectFacts(text);
  if (!effects) {
    return;
  }
  const heading = /^✨ 使用技能：(.+)（MP -[\d,]+）$/u.exec(
    text.split("\n")[0].trim(),
  );
  if (heading) {
    return heading[1] === request.slice("/skill ".length) &&
      parseNativeCombat(text, source).complete
      ? effects
      : undefined;
  }
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const effectLine =
    /^(?:接下來(?:的)?\s*[1-9]\d*\s*次受擊減傷\s*\d+%|易傷\s*\d+%|DOT[：:]\s*\d+)$/u;
  return lines.length > 0 &&
    lines.every(
      (line) => effectLine.test(line) && runtimeEffectFacts(line)?.length === 1,
    )
    ? effects
    : undefined;
}
