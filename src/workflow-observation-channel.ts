import { parseInventory } from "./inventory.js";
import type {
  Observation,
  ObservationChannel,
} from "./workflow-observation-types.js";
import {
  homeFacts,
  roomFacts,
  skillsFacts,
  statusFacts,
  towerFacts,
} from "./workflow-parsers.js";

/** 觀測來源的相依區塊；未知訊息不推定為已核通道。 */
export function observationChannel(
  record: Observation | undefined,
): ObservationChannel | null {
  if (!record) {
    return null;
  }
  const message = record.message;
  if (statusFacts(message)) {
    return "status";
  }
  if (towerFacts(message.text)) {
    return "tower";
  }
  if (roomFacts(message.text)) {
    return "room";
  }
  if (homeFacts(message.text)) {
    return "home";
  }
  if (skillsFacts(message.text)) {
    return "skills";
  }
  if (parseInventory(message) || record.command === "/inventory all") {
    return "inventory";
  }
  return null;
}
