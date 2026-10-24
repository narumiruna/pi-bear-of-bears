import type { GameMessage } from "./game.js";
import { parseInventory } from "./inventory.js";
import {
  hasHomeReplyHeading,
  homeReplyComplete,
} from "./workflow-home-reply.js";
import {
  roomFacts,
  skillsFacts,
  statusFacts,
  towerFacts,
} from "./workflow-parsers.js";
import { statusReplyComplete } from "./workflow-status-reply.js";

/** 共用既有唯讀面板辨識，避免帳本用局部 parser 再略過已判未知的訊息。
 * status／home 有完整行型校驗，不完整時不得回退到其他面板。
 * false 表示已辨識但不完整，undefined 表示不是這些面板。
 * inventory 的完整性、數值缺漏、TTL、角色及副作用仍由相依流程核驗。
 */
export function knownQueryObservation(message: GameMessage) {
  if (message.outgoing) {
    return false;
  }
  if (statusFacts(message)) {
    return statusReplyComplete(message.text);
  }
  if (hasHomeReplyHeading(message.text)) {
    return homeReplyComplete(message.text);
  }
  return towerFacts(message.text) ||
    roomFacts(message.text) ||
    skillsFacts(message.text) ||
    parseInventory(message)
    ? true
    : undefined;
}
