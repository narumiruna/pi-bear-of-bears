import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { truncateHead } from "@earendil-works/pi-coding-agent";

export function structuredPreview(
  value: unknown,
  path: string,
): string | undefined {
  const fits = (text: string) => Buffer.byteLength(text) <= 45000;
  const full = JSON.stringify(value);
  if (fits(full)) return full;
  const copy = JSON.parse(full);
  const arrays: unknown[][] = Array.isArray(copy)
    ? [copy]
    : copy && typeof copy === "object"
      ? Object.values(copy).filter(Array.isArray)
      : [];
  let omittedItems = 0;
  while (arrays.some((items) => items.length > 0)) {
    // 優先縮短項目最多的陣列；明確標示省略，不改寫分頁游標。
    arrays.sort((a, b) => b.length - a.length);
    arrays[0].pop();
    omittedItems++;
    const text = JSON.stringify({
      truncated: true,
      omittedItems,
      fullOutputPath: path,
      note: "預覽省略陣列尾端項目；需要完整資料時讀取 fullOutputPath，使用完畢後可刪除檔案。分頁欄位仍屬原始結果。",
      preview: copy,
    });
    if (fits(text)) return text;
  }
  return undefined;
}

export async function toolResult(value: unknown) {
  const full = JSON.stringify(value, null, 2);
  const preview = truncateHead(full, { maxBytes: 45000, maxLines: 1800 });
  let text = preview.content;
  if (preview.truncated) {
    const directory = await mkdtemp(join(tmpdir(), "bear-of-bears-"));
    const path = join(directory, "result.json");
    await writeFile(path, full, { mode: 0o600 });
    // 先嘗試完整的緊密 JSON；若仍超限，保留完整陣列項目與所有外層欄位。
    // 無法安全縮小的資料仍使用原本的文字預覽，不修補殘缺 JSON。
    const structured = structuredPreview(value, path);
    text =
      structured ??
      `${text}\n[Output truncated. Full private game output: ${path}. Delete it when no longer needed.]`;
  }
  return { content: [{ type: "text" as const, text }], details: {} };
}
