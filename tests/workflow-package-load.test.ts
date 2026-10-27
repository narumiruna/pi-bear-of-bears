import { execFileSync } from "node:child_process";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { discoverAndLoadExtensions } from "@earendil-works/pi-coding-agent";
import { expect, test, vi } from "vitest";

interface PackPreview {
  files: { path: string }[];
}

test("npm 乾跑的隔離套件可由實際 pi loader 載入全部 entry，無工具執行或 Telegram", async () => {
  const source = process.cwd();
  const preview = JSON.parse(
    execFileSync("npm", ["pack", "--dry-run", "--ignore-scripts", "--json"], {
      cwd: source,
      encoding: "utf8",
      timeout: 30000,
    }),
  ) as PackPreview[];
  const files = preview[0].files.map((file) => file.path);
  expect(
    files.some((path) => /^(?:docs|tests|\.pi|node_modules)\//u.test(path)),
  ).toBe(false);
  const directory = await mkdtemp(join(tmpdir(), "bears-package-loader-"));
  try {
    for (const path of files) {
      const target = resolve(directory, path);
      if (!target.startsWith(directory + sep)) {
        throw new Error("套件路徑超出隔離目錄");
      }
      await mkdir(dirname(target), { recursive: true });
      await copyFile(resolve(source, path), target);
    }
    // 只沿用已安裝且靜態盤點過的 peer／dependencies，不執行安裝或 lifecycle。
    await symlink(
      resolve(source, "node_modules"),
      join(directory, "node_modules"),
      "dir",
    );
    const manifest = JSON.parse(
      await readFile(join(directory, "package.json"), "utf8"),
    ) as { pi: { extensions: string[]; skills: string[] } };
    const agentDir = join(directory, "agent");
    await mkdir(agentDir);
    vi.stubEnv("BEARS_SESSION_FILE", join(agentDir, "missing-session"));
    vi.stubEnv("TELEGRAM_API_ID", "");
    vi.stubEnv("TELEGRAM_API_HASH", "");
    const loaded = await discoverAndLoadExtensions(
      manifest.pi.extensions.map((path) => resolve(directory, path)),
      directory,
      agentDir,
    );
    expect(loaded.errors).toEqual([]);
    expect(loaded.extensions).toHaveLength(manifest.pi.extensions.length);
    const entries = loaded.extensions.flatMap((extension) => [
      ...extension.tools,
    ]);
    expect(new Set(entries.map(([name]) => name)).size).toBe(entries.length);
    const tools = new Map(entries);
    for (const name of [
      "bears_combat_snapshot",
      "bears_inventory_snapshot",
      "bears_reconcile_rewards",
      "bears_tower_entry_check",
      "bears_plan_upgrade",
      "bears_tower_recover",
      "bears_plan_tower_step",
      "bears_equip_upgrade",
      "bears_move_to",
      "bears_balance_wallet",
    ]) {
      expect(tools.has(name)).toBe(true);
    }
    expect(
      tools.get("bears_reconcile_rewards")?.definition.parameters,
    ).toMatchObject({ properties: { historical: { type: "boolean" } } });
    for (const path of manifest.pi.skills) {
      expect(files).toContain(path.replace(/^\.\//u, ""));
    }
    // 僅匯入與註冊；不送 session_start、不呼叫 tool、不建立 Game transport。
  } finally {
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  }
}, 30000);
