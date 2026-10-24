import { parseInventory } from "./inventory.js";
import type { Observation } from "./workflow-observation-types.js";

/** 呼叫者先限定角色／分支／barrier；歷史研究可保留原時間而不延長資格。 */
export function inventoryObservation(records: Observation[], maxAge = 300_000) {
  for (let index = records.length - 1; index >= 0; index--) {
    if (!/^🎒 背包（/u.test(records[index].message.text)) {
      continue;
    }
    const parts = [records[index]];
    if (!/🔢 用編號最方便：/u.test(parts[0].message.text)) {
      for (const next of records.slice(index + 1)) {
        if (!/^\s*\d+\. /u.test(next.message.text)) {
          break;
        }
        parts.push(next);
        if (/🔢 用編號最方便：/u.test(next.message.text)) {
          break;
        }
      }
    }
    const last = parts.at(-1);
    if (!last) {
      return;
    }
    const value = parseInventory({
      ...last.message,
      text: parts.map((part) => part.message.text).join("\n"),
    });
    if (!value) {
      return;
    }
    const sources = parts.map((part) => part.source);
    if (
      sources.some(
        (source) =>
          Date.now() - source.date * 1000 > maxAge ||
          source.date * 1000 > Date.now() ||
          source.observedAt > Date.now(),
      )
    ) {
      return;
    }
    return { value, sources };
  }
}
