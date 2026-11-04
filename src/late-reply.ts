import { parseNativeCombat } from "./combat-native.js";
import type { GameMessage } from "./game.js";
import { statusFacts } from "./workflow-parsers.js";

export const LATE_REPLY_EVENT = "bears:late-reply-candidate";
export interface LateReplyCandidate {
  request: string;
  outgoingId: number;
  messageId: number;
  revision: string;
  originalSourceId: string;
  actor: string;
  operationalEligibility: false;
}

/** 僅提示可重新核驗的候選，不綁定戰果或刷新操作資格。不連線、不重送。 */
export class LateReplyCandidates {
  private readonly messages = new Map<number, GameMessage>();
  private pending?: { request: string; afterId: number };
  private readonly notified = new Set<string>();
  reset() {
    this.messages.clear();
    this.pending = undefined;
    this.notified.clear();
  }
  expect(request: string) {
    // 只支援原生技能回覆；其他指令維持原有未知結果處理。
    this.pending = undefined;
    if (!/^\/skill \S.+$/u.test(request)) {
      return;
    }
    this.pending = {
      request,
      afterId: Math.max(
        0,
        ...[...this.messages.values()]
          .filter((m) => !m.outgoing)
          .map((m) => m.id),
      ),
    };
  }
  observe(
    messages: readonly GameMessage[],
    originalSourceId: string,
    omitted = 0,
  ): LateReplyCandidate[] {
    if (omitted) {
      this.reset();
      return [];
    }
    for (const message of messages) {
      const old = this.messages.get(message.id);
      if (old && old.revision !== message.revision) {
        // 修訂只作新觀測，不沿用舊送達或身分證據。
        this.reset();
        return [];
      }
      this.messages.set(message.id, structuredClone(message));
    }
    while (this.messages.size > 100) {
      this.messages.delete(Math.min(...this.messages.keys()));
    }
    if (!this.pending) {
      return [];
    }
    const ordered = [...this.messages.values()].sort((a, b) => a.id - b.id);
    const candidates: LateReplyCandidate[] = [];
    for (const message of messages) {
      if (message.outgoing || message.id <= this.pending.afterId) {
        continue;
      }
      const anchor = ordered
        .filter((m) => m.outgoing && m.id < message.id)
        .at(-1);
      if (
        !anchor ||
        anchor.text !== this.pending.request ||
        anchor.date > message.date
      ) {
        continue;
      }
      const status = ordered
        .filter((m) => m.id < anchor.id && statusFacts(m))
        .at(-1);
      const actor = status && statusFacts(status)?.name;
      if (
        !status ||
        !actor ||
        ordered.some(
          (m) =>
            m.id > status.id &&
            m.id < message.id &&
            ((m.outgoing &&
              /^\/(?:switch|create|start|rename|advance)(?:\s|$)/u.test(
                m.text,
              )) ||
              (statusFacts(m) && statusFacts(m)?.name !== actor)),
        )
      ) {
        continue;
      }
      // 完整解析只是候選篩選，不等同因果證明；公告／孤立回覆不通知。
      const heading = /^✨ 使用技能：(.+)（MP -[\d,]+）/u.exec(message.text);
      if (
        heading?.[1] !== this.pending.request.slice(7) ||
        !parseNativeCombat(message.text, {
          messageId: message.id,
          revision: message.revision,
          date: message.date,
          observedAt: Date.now(),
        }).complete
      ) {
        continue;
      }
      const key = `${anchor.id}:${message.id}:${message.revision}`;
      if (this.notified.has(key)) {
        continue;
      }
      this.notified.add(key);
      if (this.notified.size > 100) {
        const oldest = this.notified.values().next().value;
        if (oldest !== undefined) {
          this.notified.delete(oldest);
        }
      }
      candidates.push({
        request: anchor.text,
        outgoingId: anchor.id,
        messageId: message.id,
        revision: message.revision,
        originalSourceId,
        actor,
        operationalEligibility: false,
      });
    }
    return candidates;
  }
}
