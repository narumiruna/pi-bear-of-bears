import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { truncateHead } from "@earendil-works/pi-coding-agent";

export async function toolResult(value: unknown) {
  const full = JSON.stringify(value, null, 2);
  const preview = truncateHead(full, { maxBytes: 45000, maxLines: 1800 });
  let text = preview.content;
  if (preview.truncated) {
    const directory = await mkdtemp(join(tmpdir(), "bear-of-bears-"));
    const path = join(directory, "result.json");
    await writeFile(path, full, { mode: 0o600 });
    text += `\n[Output truncated. Full private game output: ${path}. Delete it when no longer needed.]`;
  }
  return { content: [{ type: "text" as const, text }], details: {} };
}
