import {
  appendFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { fingerprint } from "./ledger-facts.js";
import type { validatePublicRetention } from "./ledger-retention-run.js";

function wikiLines(text: string) {
  return text
    .split("\n")
    .map((line) => line.replace(/^\s*(?:>\s*|[-*]\s+)/u, "").trim())
    .join("\n")
    .trim();
}
function existingWikiQuotes(root: string) {
  const texts: string[] = [];
  let bytes = 0;
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === "ledger-knowledge") {
        continue;
      }
      const path = join(directory, entry.name),
        stat = lstatSync(path);
      if (stat.isSymbolicLink()) {
        throw new Error("Wiki含symlink，未整理或刪帳。");
      }
      if (stat.isDirectory()) {
        visit(path);
      } else if (
        entry.name.endsWith(".md") &&
        !["INDEX.md", "AGENTS.md"].includes(entry.name)
      ) {
        if (stat.nlink !== 1) {
          throw new Error("Wiki含hardlink，未整理或刪帳。");
        }
        bytes += stat.size;
        if (bytes > 10000000 || texts.length >= 2000) {
          throw new Error("Wiki稽核超過有界範圍；不刪帳。");
        }
        texts.push(`\n${wikiLines(readFileSync(path, "utf8"))}\n`);
      }
    }
  };
  visit(root);
  return texts;
}
/** 只處理已通過公開來源驗證的逐字引用；永遠不接受模型提供的檔名或任意路徑。 */
export async function publishRetentionWiki(
  candidates: ReturnType<typeof validatePublicRetention>,
  cwd: string,
) {
  if (candidates.length === 0) {
    return;
  }
  const root = resolve(cwd, "wiki"),
    directory = join(root, "ledger-knowledge");
  await withFileMutationQueue(join(root, "INDEX.md"), async () => {
    await Promise.resolve();
    for (const path of [root, join(root, "INDEX.md")]) {
      const stat = lstatSync(path);
      if (
        stat.isSymbolicLink() ||
        (path.endsWith("INDEX.md") && (!stat.isFile() || stat.nlink !== 1))
      ) {
        throw new Error("Wiki來源是不安全連結或非一般檔案；未覆寫。");
      }
    }
    const known = existingWikiQuotes(root);
    const pending = candidates.filter(
      (c) => !known.some((text) => text.includes(`\n${wikiLines(c.quote)}\n`)),
    );
    if (pending.length === 0) {
      return;
    }
    if (!existsSync(directory)) {
      mkdirSync(directory);
    }
    if (
      !lstatSync(directory).isDirectory() ||
      lstatSync(directory).isSymbolicLink()
    ) {
      throw new Error("Wiki目錄不安全。");
    }
    const index = join(directory, "INDEX.md");
    if (!existsSync(index)) {
      writeFileSync(
        index,
        "# 公開資料摘錄\n\n只收錄有公開來源的逐字摘錄；不含角色戰報，不代表即時遊戲狀態。\n",
        { flag: "wx" },
      );
    }
    if (
      lstatSync(index).isSymbolicLink() ||
      !lstatSync(index).isFile() ||
      lstatSync(index).nlink !== 1
    ) {
      throw new Error("Wiki索引不安全。");
    }
    for (const candidate of pending) {
      const id = fingerprint({
          quote: candidate.quote,
          url: candidate.source.url,
        }),
        filename = `${id}.md`,
        path = join(directory, filename);
      const base = `# 公開遊戲資料摘錄\n\n觀測日期：${candidate.source.observedDate}\n\n來源：[公開BOSS圖鑑](${candidate.source.url})\n\n${candidate.quote
        .split("\n")
        .map((line) => `> ${line}`)
        .join(
          "\n",
        )}\n\n此為來源當時內容，可能過期；不構成操作授權或當下戰鬥安全證明。\n`;
      const content = `${base}\n<!-- bears-retention ${id} ${fingerprint(base)} -->\n`;
      if (existsSync(path)) {
        const stat = lstatSync(path);
        if (stat.isSymbolicLink() || stat.nlink !== 1 || !stat.isFile()) {
          throw new Error("Wiki摘錄是不安全連結；未讀取或覆寫。");
        }
        const previous = readFileSync(path, "utf8");
        const marker =
          /\n<!-- bears-retention ([a-f0-9]{64}) ([a-f0-9]{64}) -->\n$/u.exec(
            previous,
          );
        if (
          !marker ||
          marker[1] !== id ||
          fingerprint(previous.slice(0, marker.index)) !== marker[2]
        ) {
          throw new Error("Wiki摘錄已被人工修改；未覆寫。");
        }
      } else {
        writeFileSync(path, content, { flag: "wx" });
      }
      const link = `- [公開資料 ${id.slice(0, 12)}](${filename})\n`;
      if (!readFileSync(index, "utf8").includes(link)) {
        appendFileSync(index, `\n${link}`);
      }
    }
    const rootIndex = join(root, "INDEX.md"),
      link = "- [公開資料摘錄](ledger-knowledge/INDEX.md)\n";
    if (!readFileSync(rootIndex, "utf8").includes(link)) {
      appendFileSync(rootIndex, `\n${link}`);
    }
  });
}
