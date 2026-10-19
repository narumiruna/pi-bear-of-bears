import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { resolve } from "node:path";

// 固定計畫前的 Git 版本；只匯出程式與離線 harness，不切換工作樹或安裝依賴。
const baseline = "20b70ac3ab4217df1ffa333d6466adf644d9bebf";
const directory = resolve("benchmarks/.baseline");
const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, { timeout: 300000, ...options });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      `${command} failed (${result.status}): ${result.stderr?.toString() ?? ""}`,
    );
  }
  return result;
};
const files = [
  ...readdirSync("src")
    .filter((name) => name.endsWith(".ts"))
    .map((name) => `src/${name}`),
  "tests/fixtures/workflow.ts",
  "benchmarks/agent-extension.test.ts",
].sort();
const hash = createHash("sha256");
for (const path of files) {
  hash.update(path).update("\0").update(readFileSync(path)).update("\0");
}
process.stdout.write(
  `baseline=${baseline} currentSourceSha256=${hash.digest("hex")} node=${process.version}\n`,
);
let created = false;
try {
  // 已存在時停止，不刪除別人的目錄或未完成工作。
  mkdirSync(directory, { mode: 0o700 });
  created = true;
  const archive = run(
    "git",
    [
      "archive",
      "--format=tar",
      baseline,
      "src",
      "tests/fixtures/workflow.ts",
      "package.json",
    ],
    { maxBuffer: 8 * 1024 * 1024 },
  );
  run("tar", ["-xf", "-", "-C", directory], { input: archive.stdout });
  symlinkSync(
    resolve("node_modules"),
    resolve(directory, "node_modules"),
    "dir",
  );
  run(
    "npm",
    [
      "exec",
      "--",
      "vitest",
      "run",
      "--config",
      "benchmarks/vitest.config.ts",
      ...process.argv.slice(2),
    ],
    { stdio: "inherit" },
  );
} finally {
  if (created) {
    rmSync(directory, { recursive: true, force: true });
  }
}
