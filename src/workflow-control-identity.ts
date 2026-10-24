import type { Source } from "./workflow-observation-types.js";

const SWITCH = /^\/switch\s+\S/u;

/** 只追蹤控制身分待確認的邊界；角色與可信資源仍由原始 status/store 提供。 */
export class ControlIdentity {
  private after: number | null = null;
  get pending() {
    return this.after !== null;
  }
  reset() {
    this.after = null;
  }
  requested(request: string | undefined, lastObservedId: number) {
    if (SWITCH.test(request ?? "")) {
      this.after = lastObservedId;
    }
  }
  outgoing(id: number, text: string, confirmedStatusId: number) {
    if (SWITCH.test(text) && id > confirmedStatusId) {
      this.after = id;
    }
  }
  confirm(source: Source, completeStatus: boolean) {
    if (
      this.after !== null &&
      completeStatus &&
      source.messageId > this.after &&
      source.observedAt >= source.date * 1000 &&
      source.observedAt - source.date * 1000 <= 60_000
    ) {
      this.after = null;
    }
  }
}
