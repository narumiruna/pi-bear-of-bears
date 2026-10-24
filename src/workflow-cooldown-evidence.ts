import type { Observation, Source } from "./workflow-observation-types.js";

interface WinEvidence {
  character: string;
  source: Source;
  target: { name: string | null; type: string };
}

/** 只索引既有正式勝報與待核來源，不解析未知冷卻、推算到期或建立資格。 */
export function cooldownEvidence(
  records: Observation[],
  wins: WinEvidence[],
  incomplete: Source[],
) {
  const unresolved = new Set(
    incomplete.map((source) => `${source.messageId}:${source.revision}`),
  );
  const latest = new Map<string, number>();
  const unverified: {
    character: string | null;
    source: Source;
    kinds: string[];
  }[] = [];
  const keywordSources = [];
  for (const record of records) {
    if (record.message.outgoing) {
      continue;
    }
    if (record.actor) {
      latest.set(
        record.actor,
        Math.max(latest.get(record.actor) ?? 0, record.message.id),
      );
    }
    const keyword = /討伐限制|冷卻|掛機/u.test(record.message.text);
    const combat = unresolved.has(
      `${record.message.id}:${record.message.revision}`,
    );
    if (keyword) {
      keywordSources.push({ character: record.actor, source: record.source });
    }
    if (keyword || combat) {
      unverified.push({
        character: record.actor,
        source: record.source,
        kinds: [
          keyword ? "keyword_message_unverified" : null,
          combat ? "unindexed_combat_reply" : null,
        ].filter((kind) => kind !== null),
      });
    }
  }
  const actors = [...latest].sort((a, b) => b[1] - a[1]).map(([name]) => name);
  const unbound = unverified.filter((entry) => entry.character === null);
  const generations = new Map(
    records.map((record) => [record.message.id, record.epoch]),
  );
  return structuredClone({
    state: "needs_observation",
    eligible: null,
    sources: keywordSources.slice(-20),
    omittedSources: Math.max(0, keywordSources.length - 20),
    characters: actors.slice(0, 20).map((character) => {
      const ownWins = wins.filter((win) => win.character === character);
      const reports = unverified.filter(
        (entry) => entry.character === character,
      );
      return {
        character,
        state: "needs_observation",
        eligible: null,
        restrictionConfirmed: false,
        expiresAt: null,
        knownWins: ownWins.slice(-20).map((win) => ({
          source: win.source,
          target: win.target,
          generation: generations.get(win.source.messageId) ?? null,
        })),
        omittedWins: Math.max(0, ownWins.length - 20),
        unverifiedSources: reports.slice(-20),
        omittedUnverifiedSources: Math.max(0, reports.length - 20),
      };
    }),
    omittedCharacters: Math.max(0, actors.length - 20),
    unboundSources: unbound.slice(-20),
    omittedUnboundSources: Math.max(0, unbound.length - 20),
    coverage: "saved_records_only",
    note: "私人限制需本人正式勝場及明示冷卻。角色依已保存觀測歸屬；關鍵字不是正式私人規則，未支援的原生／戰鬥回報可能缺證。沒有來源不等於沒有限制；公開存活或時間經過不會產生資格。此摘要不判定候選的限制適用範圍，也不是所有戰鬥禁令，仍須按具體目標核對。",
  });
}
