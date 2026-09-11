import { compactBearsOutput } from "./compact-context.js";

const KIBIBYTE = 1024;
const DEFAULT_MAX_BYTES = 2 * KIBIBYTE * KIBIBYTE;
const DEFAULT_MAX_ENTRIES = 256;

// 以原始文字為鍵，避免依賴 context 深拷貝後的物件身分。
export function createCompactCache(
  maxBytes = DEFAULT_MAX_BYTES,
  maxEntries = DEFAULT_MAX_ENTRIES,
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
    if (size > maxBytes || maxEntries <= 0) {
      return text;
    }
    while (entries.size >= maxEntries || bytes + size > maxBytes) {
      const key = entries.keys().next().value;
      if (key === undefined) {
        break;
      }
      bytes -= entries.get(key)?.bytes ?? 0;
      entries.delete(key);
    }
    entries.set(source, { text, bytes: size });
    bytes += size;
    return text;
  };
}
