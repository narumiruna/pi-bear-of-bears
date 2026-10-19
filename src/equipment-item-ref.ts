import { createHash } from "node:crypto";
import type { EquipmentCandidate } from "./equipment-optimizer.js";
import type { GameMessage } from "./game.js";
import type { InventoryEntry } from "./inventory.js";

const digest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

interface InventorySource {
  messageId: number;
  revision: string;
  date: number;
}

export function mergeInventoryFragments(messages: readonly GameMessage[]) {
  const latest = messages.at(-1);
  return latest
    ? {
        ...structuredClone(latest),
        text: messages.map((message) => message.text).join("\n"),
      }
    : undefined;
}

export function sameInventorySources(
  sources: InventorySource[],
  parts: GameMessage[],
) {
  return (
    sources.length === parts.length &&
    parts.every(
      (part, index) =>
        sources[index].messageId === part.id &&
        sources[index].revision === part.revision &&
        sources[index].date === part.date,
    )
  );
}

/** 本機參照只綁定一次完整背包與已觀察事實，不建立後端永久 ID。 */
export function equipmentItemReferences(
  epoch: string,
  actor: string | undefined,
  inventory:
    | {
        message: GameMessage;
        sources: InventorySource[];
        parsed: { complete: boolean; entries: InventoryEntry[] };
      }
    | undefined,
  items: EquipmentCandidate[],
) {
  const inventoryVersion =
    inventory && actor
      ? digest({
          epoch,
          actor,
          message: inventory.message,
          sources: inventory.sources.map(({ messageId, revision, date }) => ({
            messageId,
            revision,
            date,
          })),
        })
      : null;
  const identities = items.flatMap((item) => {
    const entry = inventory?.parsed.entries.find(
      (entry) => entry.id === item.id,
    );
    if (!entry) {
      return [];
    }
    const { id: _row, ...observed } = entry;
    return [
      {
        rowNumber: item.id,
        observed,
        slot: item.slot,
        fingerprint: digest({
          observed,
          slot: item.slot,
          stats: item.stats,
          effects: item.effects,
        }),
      },
    ];
  });
  const ambiguous = identities.some(
    (identity) =>
      identities.filter((other) => other.fingerprint === identity.fingerprint)
        .length !== 1,
  );
  return {
    inventoryVersion,
    blockers: ambiguous ? ["不可區分的同樣物品沒有個體參照，禁止套用。"] : [],
    references:
      !ambiguous && inventoryVersion && inventory?.parsed.complete && actor
        ? identities.map((identity) => ({
            ...identity,
            backendItemId: null,
            actor,
            inventoryVersion,
            itemRef: `item:${digest({ inventoryVersion, identity })}`,
          }))
        : [],
  };
}
