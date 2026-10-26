import { ledgerPage } from "./ledger-query.js";
export class LedgerPages {
  private readonly snapshots = new Map<
    string,
    { key: string; data: unknown; bytes: number }
  >();
  private bytes = 0;
  page(
    kind: "trace" | "report",
    key: string,
    query: () => unknown,
    params: { offset?: number; limit?: number; snapshot?: string },
  ) {
    if ((params.offset ?? 0) > 0 && !params.snapshot) {
      throw new Error("續頁必須附上一頁的 snapshot，不重查可變報表。");
    }
    let data: unknown;
    if (params.snapshot) {
      const saved = this.snapshots.get(`${kind}:${key}:${params.snapshot}`);
      if (!saved || saved.key !== key) {
        throw new Error(
          "snapshot 已過期、分支已改變或查詢條件不符；請從 offset 0 重查。",
        );
      }
      data = saved.data;
    } else {
      data = query();
      const bytes = Buffer.byteLength(JSON.stringify(data));
      if (bytes > 2 * 1024 * 1024) {
        throw new Error(
          "報表超過 2 MiB；請縮小訊息區間或使用 afterObservationId。",
        );
      }
      const first = ledgerPage(kind, data, params.offset, params.limit);
      while (this.snapshots.size >= 8 || this.bytes + bytes > 4 * 1024 * 1024) {
        const oldest = this.snapshots.keys().next().value;
        if (!oldest) {
          break;
        }
        this.bytes -= this.snapshots.get(oldest)?.bytes ?? 0;
        this.snapshots.delete(oldest);
      }
      const storageKey = `${kind}:${key}:${first.snapshot}`;
      if (!this.snapshots.has(storageKey)) {
        this.snapshots.set(storageKey, { key, data, bytes });
        this.bytes += bytes;
      }
      return first;
    }
    return ledgerPage(kind, data, params.offset, params.limit);
  }
  reset() {
    this.snapshots.clear();
    this.bytes = 0;
  }
}
