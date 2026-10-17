import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory()
      ? sources(path)
      : path.endsWith(".ts")
        ? [path]
        : [];
  });
}

test("所有專案註冊的 Agent tools 預設只透過 codemode 暴露", () => {
  let registrations = 0;
  for (const path of [...sources("extensions"), ...sources("src")]) {
    const source = readFileSync(path, "utf8");
    const calls = [...source.matchAll(/\.registerTool\(/g)];
    const definitions = [
      ...source.matchAll(/\.registerTool\(\{([\s\S]*?)\bparameters:/g),
    ];
    // New registration forms must also be covered, not silently skipped.
    expect(definitions.length, path).toBe(calls.length);
    for (const definition of definitions) {
      expect(definition[1], path).toMatch(/\bexposure:\s*["']codemode["']/);
      registrations++;
    }
  }
  expect(registrations).toBeGreaterThanOrEqual(14);
});

test("啟動腳本明確載入並啟用內建 codemode，不依賴 MCP server 設定", () => {
  const script = readFileSync("run.sh", "utf8");
  expect(script).toContain("-e builtin:codemode");
  expect(script).toContain("--tools +codemode");
});
