import { compactBearsOutput } from "./compact-context.js";

// 以原始文字為鍵，避免依賴 context 深拷貝後的物件身分。
export function createCompactCache(
  maxBytes = 2 * 1024 * 1024,
  maxEntries = 256,
) {
  const entries = new Map<string, { text: string; bytes: number }>();
  let bytes = 0;
  return (source: string): string => {
    const hit = entries.get(source);
    if (hit) {
      entries.delete(source);
      entries.set(source, hit);
      return hit.text;
    }
    const text = compactBearsOutput(source);
    const size = Buffer.byteLength(source) + Buffer.byteLength(text);
    if (size > maxBytes || maxEntries <= 0) return text;
    while (entries.size >= maxEntries || bytes + size > maxBytes) {
      const key = entries.keys().next().value;
      if (key === undefined) break;
      bytes -= entries.get(key)?.bytes ?? 0;
      entries.delete(key);
    }
    entries.set(source, { text, bytes: size });
    bytes += size;
    return text;
  };
}
