import type { CombatEvent, Fact } from "./combat-events.js";
import { nativeEnemyEffect } from "./combat-native-enemy-effects.js";
import { nativeMagicEffect } from "./combat-native-magic.js";
import { nativeTowerFooter } from "./combat-native-tower.js";
import type { Source } from "./workflow-observations.js";
import { numberValue } from "./workflow-parsers.js";

const fact = (
  value: number | null,
  basis: Fact["basis"] = "observed",
): Fact => ({
  value,
  basis: value === null ? "unknown" : basis,
});

/** 僅解析有定位原文的技能回覆；事件順序是輸出順序，不聲稱後端執行協定。 */
class NativeCombat {
  events: CombatEvent[] = [];
  issues: string[] = [];
  unknownLines: { line: number; text: string }[] = [];
  targets = new Set<string>();
  player: { hp: number; max: number } | null = null;
  enemy: { hp: number; max: number } | null = null;
  initiative: string | null = null;
  skillName: string | null = null;
  settled = false;
  counter = false;
  royalStrike = false;
  gold: number | null = null;
  shield: {
    remainingHits: null;
    bounds: { min: number; max: number };
    basis: string;
    assumptions: string[];
  } | null = null;

  number(raw: string | undefined) {
    const value = numberValue(raw);
    if (value === null) {
      this.issues.push("數值無效或超過安全整數範圍。");
    }
    return value;
  }

  hpEvent(kind: string, raw: string[], line: number, enemy = false) {
    const nominal = this.number(raw[0]),
      after = this.number(raw[1]),
      max = this.number(raw[2]);
    const previous = enemy ? this.enemy : this.player;
    const event: CombatEvent = {
      line,
      kind,
      nominal: fact(nominal),
      actual: fact(null),
    };
    if (
      nominal === null ||
      after === null ||
      max === null ||
      max <= 0 ||
      after > max ||
      (previous && previous.max !== max)
    ) {
      this.issues.push(`第${line}行 HP 或數值矛盾。`);
      this.events.push(event);
      return;
    }
    event.hpAfter = fact(after);
    event.maxHp = fact(max);
    const difference = previous
      ? kind === "healing"
        ? after - previous.hp
        : previous.hp - after
      : null;
    if (
      difference !== null &&
      (difference < 0 ||
        difference > nominal ||
        (!enemy && kind !== "healing" && difference !== nominal))
    ) {
      this.issues.push(`第${line}行 HP 轉移與回覆數值矛盾。`);
    } else if (!enemy && kind !== "healing") {
      // 「你受到」「消耗」是已發生數值；不把未來傷害或名義治療當作實際 HP。
      event.actual = fact(nominal);
    } else if (difference !== null) {
      event.actual = fact(difference, "derived");
    }
    if (enemy) {
      this.enemy = { hp: after, max };
    } else {
      this.player = { hp: after, max };
    }
    this.events.push(event);
  }

  damage(line: string, position: number) {
    const single =
      /^造成 ([\d,]+) 點傷害！[^\p{L}\p{N}]* HP：([\d,]+)\/([\d,]+)$/u.exec(
        line,
      );
    if (single) {
      this.hpEvent("damage", single.slice(1), position, true);
      return true;
    }
    const multi =
      /^🌀 連續攻擊 ([\d,]+) 段：([\d,＋]+) ＝ 共 ([\d,]+) 傷害！\s+[^\p{L}\p{N}]* HP：([\d,]+)\/([\d,]+)$/u.exec(
        line,
      );
    if (multi) {
      const count = this.number(multi[1]),
        parts = multi[2].split("＋").map((value) => this.number(value));
      const total = this.number(multi[3]);
      const sum = parts.every((value): value is number => value !== null)
        ? parts.reduce((sum, value) => sum + value, 0)
        : NaN;
      if (
        count !== parts.length ||
        parts.includes(null) ||
        !Number.isSafeInteger(sum) ||
        total !== sum
      ) {
        this.issues.push("多段傷害數量或加總矛盾。");
      }
      this.hpEvent("damage", multi.slice(3), position, true);
      return true;
    }
    const critical =
      /^💥 爆擊追擊 \+([\d,]+)！[^\p{L}\p{N}]* HP：([\d,]+)\/([\d,]+)$/u.exec(
        line,
      );
    if (critical) {
      this.hpEvent("critical_followup", critical.slice(1), position, true);
      return true;
    }
    const extra =
      /^(?:⚡ 連擊追加|🌵 荊棘反傷) ([\d,]+)！[^\p{L}\p{N}]* HP：([\d,]+)\/([\d,]+)$/u.exec(
        line,
      );
    if (extra) {
      this.hpEvent(
        line.startsWith("🌵") ? "reflection" : "additional_damage",
        extra.slice(1),
        position,
        true,
      );
      return true;
    }
    return false;
  }

  playerEvent(line: string, position: number) {
    const initiative = /^💨 (.+) 搶得先機！$/u.exec(line);
    if (initiative) {
      if (this.initiative) {
        this.issues.push("先機傷害缺段。");
      }
      this.targets.add(initiative[1]);
      this.initiative = initiative[1];
      this.events.push({
        line: position,
        kind: "initiative_marker",
        description: line,
      });
      return true;
    }
    const incoming = /^你受到 ([\d,]+) 點傷害。HP：([\d,]+)\/([\d,]+)$/u.exec(
      line,
    );
    if (incoming && this.initiative) {
      this.hpEvent("initiative", incoming.slice(1), position);
      this.initiative = null;
      return true;
    }
    const counter =
      /^[^\p{L}\p{N}]+反擊！你受到 ([\d,]+) 傷害。HP：([\d,]+)\/([\d,]+)$/u.exec(
        line,
      );
    if (counter) {
      this.counter = true;
      this.hpEvent("counter", counter.slice(1), position);
      return true;
    }
    const healing =
      /^(?:🩸 吸血！恢復 ([\d,]+) HP。|🩸 神話吸血 \+([\d,]+)(?:（重傷衰減）)?\s+|💚 恢復 ([\d,]+) HP！)HP：([\d,]+)\/([\d,]+)$/u.exec(
        line,
      );
    if (healing) {
      this.hpEvent(
        "healing",
        [healing[1] ?? healing[2] ?? healing[3], healing[4], healing[5]],
        position,
      );
      const event = this.events.at(-1);
      if (event) {
        if (healing[2] !== undefined && line.includes("（重傷衰減）")) {
          // 只保留回覆名目與標記；不反推未衰減值或再次套倍率。
          event.description = line;
        }
        // 已核技能表明列兩技的主動吸取；一般吸血文案本身不證明裝備被動。
        const activeDrain =
          this.skillName === "血怒亂斬" || this.skillName === "嗜血狂殺";
        event.healingSource =
          healing[1] !== undefined
            ? activeDrain
              ? "active_skill"
              : "unknown"
            : healing[2] !== undefined
              ? "mythic_lifesteal"
              : "active_skill";
        const nominal = event.nominal?.value,
          actual = event.actual?.value;
        event.unappliedNominal = fact(
          typeof nominal === "number" && typeof actual === "number"
            ? nominal - actual
            : null,
          "derived",
        );
        // 名目與實補的差可能含治療衰減；缺協定時不全部冒稱溢補。
        event.overheal = fact(
          typeof nominal === "number" && nominal === actual ? 0 : null,
          "derived",
        );
      }
      return true;
    }
    const blood =
      /^🔥 狂化反噬！消耗 ([\d,]+) HP。HP：([\d,]+)\/([\d,]+)$/u.exec(line);
    if (blood) {
      this.hpEvent("hp_cost", blood.slice(1), position);
      return true;
    }
    const attackDodge = /^🌀 你閃過了 (.+) 的攻擊！$/u.exec(line);
    if (attackDodge && this.initiative) {
      this.targets.add(attackDodge[1]);
      if (attackDodge[1] === this.initiative) {
        this.initiative = null;
      } else {
        this.issues.push("先機與閃避攻擊的目標矛盾。");
      }
      // 閃避只解除這次先機缺段，不推定 HP、傷害上界或未來命中。
      this.events.push({ line: position, kind: "dodge", description: line });
      return true;
    }
    const dodge = /^🌀 你閃過了 (.+) 的反擊！$/u.exec(line);
    if (dodge) {
      this.targets.add(dodge[1]);
      this.events.push({ line: position, kind: "dodge", description: line });
      return true;
    }
    return false;
  }

  towerProtection(line: string, position: number) {
    const towerCap =
      /^🛡️ 星塔庇護：單次傷害至多 ([\d,]+)（你血量上限的 ([\d,]+)%）$/u.exec(
        line,
      );
    if (!towerCap) {
      return false;
    }
    const cap = this.number(towerCap[1]),
      percent = this.number(towerCap[2]);
    if (cap === null || percent === null || percent <= 0 || percent > 100) {
      this.issues.push("星塔庇護數值無效。");
    }
    // 只保存回執註記；不推減傷順序、護盾耗次或未來承傷上界。
    this.events.push({
      line: position,
      kind: "effect",
      nominal: fact(cap),
      actual: fact(null),
      description: line,
    });
    return true;
  }

  effect(line: string, position: number) {
    if (
      nativeEnemyEffect(this, line, position) ||
      nativeMagicEffect(this, line, position)
    ) {
      return true;
    }
    const slayer = line === "（🐲屠王）";
    const resonance = /^（(?:🐲屠王／)?🌟星淵共鳴×([\d,]+)\+([\d,]+)%）$/u.exec(
      line,
    );
    if (slayer || resonance) {
      this.events.push({ line: position, kind: "effect", description: line });
      if (resonance) {
        // 僅保存本次回執註記，不推定 TTL、數值上界或操作資格。
        this.events.push(
          {
            line: position,
            kind: "resonance_stacks",
            nominal: fact(this.number(resonance[1])),
          },
          {
            line: position,
            kind: "resonance_percent",
            nominal: fact(this.number(resonance[2])),
          },
        );
      }
      return true;
    }
    if (this.towerProtection(line, position)) {
      return true;
    }
    const shield = /^🛡️ .+！接下來 ([\d,]+) 次受擊減傷 ([\d,]+)%$/u.exec(line);
    if (shield) {
      const hits = this.number(shield[1]),
        percent = this.number(shield[2]);
      if (hits === null || percent === null || percent > 100) {
        this.issues.push("護盾數值無效。");
      } else {
        this.shield = {
          remainingHits: null,
          bounds: { min: 0, max: hits },
          basis: "derived",
          assumptions: [
            "未取得耗次協定；不推定閃避、移動或時間是否耗次，不作生存預算。",
          ],
        };
      }
      this.events.push({
        line: position,
        kind: "effect",
        nominal: fact(percent),
        description: line,
      });
      return true;
    }
    const included = /^⚡ 武器真傷 \+([\d,]+)（無視防禦，已計入）$/u.exec(line);
    const poison = /^☠️ (.+) 劇毒侵蝕！追加 ([\d,]+) 毒傷。$/u.exec(line);
    const cap =
      /^🗿 世界王軀體如山，單擊傷害至多 ([\d,]+)（斬殺\/爆擊同樣受限）。$/u.exec(
        line,
      );
    if (included || poison || cap) {
      if (poison) {
        this.targets.add(poison[1]);
      }
      this.events.push({
        line: position,
        kind: included
          ? "included_damage"
          : poison
            ? "damage_component"
            : "effect",
        nominal: fact(this.number(included?.[1] ?? poison?.[2] ?? cap?.[1])),
        actual: fact(null),
        description: line,
      });
      return true;
    }
    return false;
  }

  settlement(line: string, position: number) {
    const won = /^💀 (.+) 倒下！EXP \+([\d,]+) {2}金幣 \+([\d,]+)$/u.exec(line);
    if (won) {
      if (this.settled || this.counter || (this.enemy && this.enemy.hp !== 0)) {
        this.issues.push("正式結算重複或與戰鬥狀態矛盾。");
      }
      this.targets.add(won[1]);
      this.number(won[2]);
      this.gold = this.number(won[3]);
      this.settled = true;
      this.events.push({
        line: position,
        kind: "settlement",
        description: "won",
        nominal: fact(this.gold),
      });
      return true;
    }
    if (
      this.settled &&
      /^(?:✨✨ 稀有掉落！.+（.+）|💠 進階素材：.+ ×[\d,]+|🧩 .+ 碎片 ×[\d,]+（[\d,]+\/[\d,]+）(?:　✅集滿！\/shards 兌換)?)$/u.test(
        line,
      )
    ) {
      this.events.push({
        line: position,
        kind: "reward_item",
        description: line,
      });
      return true;
    }
    return false;
  }

  parse(text: string, source: Source) {
    const lines = text.split("\n");
    const heading = /^✨ 使用技能：(.+)（MP -([\d,]+)）$/u.exec(lines[0]);
    if (heading) {
      this.skillName = heading[1];
      this.events.push({
        line: 1,
        kind: "mp_cost",
        nominal: fact(this.number(heading[2])),
        description: heading[1],
      });
    } else {
      this.unknownLines.push({ line: 1, text: lines[0] });
    }
    for (let index = 1; index < lines.length; index++) {
      const line = lines[index].trim(),
        position = index + 1;
      if (!line) {
        continue;
      }
      if (this.settlement(line, position)) {
        continue;
      }
      if (this.settled && this.enemy?.hp === 0) {
        const tower = nativeTowerFooter(lines.slice(index), this.gold);
        if (tower) {
          this.events.push(
            { line: position, kind: "tower_clear", nominal: fact(tower.floor) },
            {
              line: position + 1,
              kind: "tower_first_clear_gold",
              nominal: fact(tower.bonus),
            },
          );
          if (tower.essence) {
            this.events.push({
              line: position + 2,
              kind: "reward_item",
              nominal: fact(tower.essence.quantity),
              description: tower.essence.description,
            });
          }
          this.events.push({
            line: position + tower.nextIndex,
            kind: "effect",
            description: tower.next,
          });
          break;
        }
      }
      if (this.settled) {
        this.issues.push("正式結算後仍有未確認事件。");
      }
      if (this.initiative) {
        // 819046：先機與明示實傷間可有已核庇護註記；不能跳過任意效果或缺失傷害。
        if (this.towerProtection(line, position)) {
          continue;
        }
        // 先解析回執，讓同目標的明示閃避攻擊解除先機缺段。
        if (this.playerEvent(line, position)) {
          if (this.initiative) {
            this.issues.push("先機後傷害缺段或事件順序未知。");
          }
          continue;
        }
        this.issues.push("先機後傷害缺段或事件順序未知。");
      }
      if (
        this.damage(line, position) ||
        this.playerEvent(line, position) ||
        this.effect(line, position)
      ) {
        continue;
      }
      this.unknownLines.push({ line: position, text: line });
    }
    if (this.initiative) {
      this.issues.push("先機後缺少完整傷害回覆。");
    }
    if (this.royalStrike && !this.counter) {
      this.issues.push("王者重擊後缺少反擊回覆。");
    }
    if (this.targets.size > 1) {
      this.issues.push("同份回覆的目標名稱矛盾。");
    }
    if (this.unknownLines.length > 0) {
      this.issues.push("原生回覆含未解析行，保留未知，不建立攻擊候選或計獎。");
    }
    const complete = this.issues.length === 0 && Boolean(heading);
    return {
      format: "native_skill",
      target: this.targets.size === 1 ? [...this.targets][0] : null,
      battleId: null,
      source: structuredClone(source),
      events: this.events,
      complete,
      outcome: complete
        ? this.settled
          ? "won"
          : this.counter
            ? "ongoing"
            : "unknown"
        : "unknown",
      rewardGold: fact(complete && this.settled ? this.gold : null),
      shield: this.shield,
      unknownLines: this.unknownLines.slice(0, 5),
      omittedUnknownLines: Math.max(0, this.unknownLines.length - 5),
      issues: this.issues,
      riskVerified: false,
      note: "complete 只表示已觀察格式的解析覆蓋；首次治療前 HP 與過量傷害仍可未知，不跨訊息推遭遇身分或未來承傷上界。",
    };
  }
}

export function parseNativeCombat(text: string, source: Source) {
  return new NativeCombat().parse(text, source);
}
