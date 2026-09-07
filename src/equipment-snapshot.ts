import {
  type CharacterStatus,
  parseCharacterStatus,
} from "./character-status.js";
import { mergeEquipmentAttributes } from "./equipment-attributes.js";
import {
  DEFAULT_WEIGHTS,
  type EquipmentCandidate,
  type EquipmentWeights,
  optimizeEquipment,
  validateWeights,
} from "./equipment-optimizer.js";
import type { GameMessage } from "./game.js";
import { parseInspect, parseInventory } from "./inventory.js";

export interface VerifiedEquipment {
  complete: boolean;
  items: EquipmentCandidate[];
  slots: string[];
  blockers: string[];
}

/** 可信解析器與純數值核心的邊界；不接受 tool 引數提供物品或完整性。 */
export function evaluateVerifiedEquipment(
  data: VerifiedEquipment,
  weights?: EquipmentWeights,
) {
  const actual = validateWeights(weights ?? DEFAULT_WEIGHTS);
  const blockers = [...data.blockers];
  if (!data.complete) blockers.push("背包不完整，禁止套用。");
  if (blockers.length)
    return {
      weights: actual,
      strategySource: weights ? "explicit" : "default",
      blockers,
      recommendations: [],
      remainingRecommendations: 0,
    };
  return optimizeEquipment(data.items, { weights, slots: data.slots });
}

/** 分支內的短期觀測；不持久化、不從歷史 session 重播可信狀態。 */
export class EquipmentSnapshot {
  private version = 0;
  private newestActivity = 0;
  private epoch = 0;
  private pendingInspect?: { itemId: number; afterId: number };

  /** watch 不發送查詢；inspect 回聲可累積，其餘活動保守失效。 */
  observeLive(messages: readonly GameMessage[], omitted = 0) {
    if (omitted) {
      this.invalidate();
      return;
    }
    for (const message of [...messages].sort((a, b) => a.id - b.id)) {
      if (
        (message.outgoing && /^\/inspect \d+$/.test(message.text)) ||
        parseInspect(message)
      ) {
        this.observe([message]);
      } else {
        this.newestActivity = Math.max(this.newestActivity, message.id);
        this.invalidate();
      }
    }
  }

  get generation() {
    return this.epoch;
  }
  private character?: CharacterStatus;
  private inventory?: {
    message: GameMessage;
    observedAt: number;
    parsed: NonNullable<ReturnType<typeof parseInventory>>;
  };
  private inspections = new Map<
    number,
    {
      source: GameMessage;
      parsed: NonNullable<ReturnType<typeof parseInspect>>;
    }
  >();
  private invalidated = true;

  reset() {
    this.version++;
    this.epoch++;
    this.pendingInspect = undefined;
    this.newestActivity = 0;
    this.character = undefined;
    this.inventory = undefined;
    this.inspections.clear();
    this.invalidated = true;
  }

  observe(
    messages: readonly GameMessage[],
    now = Date.now(),
    request?: string,
    generation = this.epoch,
  ) {
    if (generation !== this.epoch) return;
    for (const message of [...messages].sort((a, b) => a.id - b.id)) {
      if (message.outgoing && message.id > this.newestActivity) {
        this.newestActivity = message.id;
        const inspectId = /^\/inspect (\d+)$/.exec(message.text)?.[1];
        this.pendingInspect =
          inspectId && this.inventory && message.id > this.inventory.message.id
            ? { itemId: Number(inspectId), afterId: message.id }
            : undefined;
        if (!/^\/(?:status|inventory|inspect \d+)$/.test(message.text))
          this.invalidate();
      }
      const status = parseCharacterStatus(message);
      if (status && (!this.character || status.id >= this.character.id)) {
        if (this.character && this.character.title !== status.title)
          this.reset();
        this.character = status;
      }
      const parsed = parseInventory(message);
      if (parsed) {
        const old = this.inventory;
        if (old && message.id < old.message.id) continue;
        if (
          old?.message.id === message.id &&
          old.message.revision === message.revision
        )
          continue;
        this.version++;
        this.pendingInspect = undefined;
        this.inspections.clear();
        this.inventory = {
          message: structuredClone(message),
          observedAt: now,
          parsed,
        };
        this.invalidated = message.id < this.newestActivity;
        continue;
      }
      const pending = this.pendingInspect;
      const id =
        pending && message.id > pending.afterId
          ? pending.itemId
          : !this.invalidated && request
            ? /^\/inspect (\d+)$/.exec(request)?.[1]
            : undefined;
      const detail = parseInspect(message);
      if (!message.outgoing && !detail) this.pendingInspect = undefined;
      const entry = this.inventory?.parsed.entries.find(
        (item) => item.id === Number(id),
      );
      if (
        detail &&
        entry &&
        message.id > (this.inventory?.message.id ?? Infinity) &&
        detail.name === entry.name &&
        this.inventory?.parsed.entries.filter(
          (item) => item.name === entry.name,
        ).length === 1
      ) {
        const previous = this.inspections.get(entry.id)?.source;
        if (
          previous &&
          (previous.id > message.id ||
            (previous.id === message.id &&
              previous.revision === message.revision))
        )
          continue;
        this.inspections.set(entry.id, {
          source: structuredClone(message),
          parsed: detail,
        });
        this.version++;
      }
    }
  }

  invalidate() {
    this.pendingInspect = undefined;
    this.invalidated = true;
    this.inspections.clear();
    this.version++;
  }

  evaluate(weights?: EquipmentWeights, now = Date.now()) {
    const inventory = this.inventory;
    const blockers = inventory
      ? [...inventory.parsed.diagnostics]
      : ["尚無本分支的新背包觀測，請查詢 /inventory。"];
    if (this.invalidated) blockers.push("觀測已失效，須重新查詢。");
    if (
      !this.character ||
      (inventory && this.character.id > inventory.message.id)
    )
      blockers.push(
        "缺少背包之前的新角色狀態，請依序查詢 /status 與 /inventory。",
      );
    if (
      inventory &&
      (now - inventory.observedAt > 300000 ||
        now < inventory.observedAt ||
        now - inventory.message.date * 1000 > 300000 ||
        inventory.message.date * 1000 > now)
    )
      blockers.push("背包觀測過期。");
    if (
      this.character &&
      (now - this.character.date * 1000 > 300000 ||
        this.character.date * 1000 > now)
    )
      blockers.push("角色觀測過期。");
    if (
      this.character &&
      /HP[：:]\s*0\//.test(this.character.sections.flat().join("\n"))
    )
      blockers.push("角色已死亡，停止套用。");
    if (
      this.character &&
      /掛機中|含掛機預估/.test(this.character.sections.flat().join("\n"))
    )
      blockers.push("須先停止掛機並確認結算。");
    const attributeEvidence: Array<
      { itemId: number } & ReturnType<typeof mergeEquipmentAttributes>
    > = [];
    const excludedItems: Array<{ itemId: number; reason: string }> = [];
    const items: EquipmentCandidate[] = (
      inventory?.parsed.entries ?? []
    ).flatMap((entry) => {
      const detail = this.inspections.get(entry.id)?.parsed;
      if (
        detail?.kind === "non-equipment" &&
        !entry.equipped &&
        !/可裝備|詞條裝/.test(entry.description)
      ) {
        excludedItems.push({
          itemId: entry.id,
          reason: "inspect 明確標示非裝備。",
        });
        return [];
      }
      const merged = mergeEquipmentAttributes(entry, detail?.description ?? "");
      attributeEvidence.push({ itemId: entry.id, ...merged });
      blockers.push(
        ...merged.diagnostics.map((text) => `物品 ${entry.id}：${text}`),
      );
      if (!detail) blockers.push(`物品 ${entry.id} 缺少可綁定的 inspect。`);
      else
        blockers.push(
          ...detail.diagnostics.map((text) => `物品 ${entry.id}：${text}`),
        );
      return {
        id: entry.id,
        name: entry.name,
        equipped: entry.equipped,
        eligible: detail?.eligible ?? null,
        slot: detail?.slot ?? null,
        stats: merged.stats,
        effects: detail?.effects ?? null,
      };
    });
    const slots = [
      ...new Set(items.flatMap((item) => (item.slot ? [item.slot] : []))),
    ];
    if (!slots.length) blockers.push("缺少已確認的部位清單。");
    const result = evaluateVerifiedEquipment(
      { complete: inventory?.parsed.complete ?? false, items, slots, blockers },
      weights,
    );
    return {
      ...result,
      version: this.version,
      attributeEvidence,
      excludedItems,
      character: this.character ?? null,
      source: inventory
        ? {
            messageId: inventory.message.id,
            revision: inventory.message.revision,
            date: inventory.message.date,
            observedAt: inventory.observedAt,
          }
        : null,
      inspectSources: [...this.inspections].map(([id, value]) => ({
        itemId: id,
        messageId: value.source.id,
        revision: value.source.revision,
        date: value.source.date,
      })),
      completeness: inventory
        ? {
            declared: inventory.parsed.total,
            listed: inventory.parsed.listed,
            complete: inventory.parsed.complete,
          }
        : null,
      current:
        inventory?.parsed.entries.filter((entry) => entry.equipped) ?? [],
      applicable: result.blockers.length === 0,
    };
  }
}
