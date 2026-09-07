import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  discoverAndLoadExtensions,
  loadSkillsFromDir,
} from "@earendil-works/pi-coding-agent";
import { expect, test } from "vitest";
import { toolResult } from "../src/output.js";

test("pi loads the TypeScript extension without login or network initialization", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bears-loader-test-"));
  try {
    const result = await discoverAndLoadExtensions(
      [resolve("extensions/bears.ts")],
      directory,
      directory,
    );
    expect(result.errors).toEqual([]);
    expect(result.extensions).toHaveLength(1);
    expect([...result.extensions[0].tools.keys()]).toEqual([
      "bears_history",
      "bears_send",
      "bears_click",
      "bears_world",
      "bears_codex",
    ]);
    expect(result.extensions[0].handlers.has("session_shutdown")).toBe(true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("pi loads the standalone character widget without starting a connection", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bears-widget-loader-test-"));
  try {
    const result = await discoverAndLoadExtensions(
      [resolve("extensions/character-status.ts")],
      directory,
      directory,
    );
    expect(result.errors).toEqual([]);
    expect(result.extensions).toHaveLength(1);
    expect(result.extensions[0].commands.has("bears-status")).toBe(true);
    expect(result.extensions[0].handlers.has("session_start")).toBe(true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("pi discovers the strategy skill without diagnostics", () => {
  const result = loadSkillsFromDir({ dir: resolve("skills"), source: "test" });
  expect(result.diagnostics).toEqual([]);
  expect(result.skills.map((skill) => skill.name)).toEqual([
    "playing-bear-of-bears",
  ]);
});

test("output remains bounded and full overflow is private", async () => {
  const data = { text: "熊".repeat(20000) };
  const result = await toolResult(data);
  const text = result.content[0].text;
  expect(Buffer.byteLength(text)).toBeLessThan(50000);
  const match = text.match(/Full private game output: (.+\/result\.json)\./);
  expect(match).not.toBeNull();
  if (!match) throw new Error("Missing overflow path");
  try {
    expect(JSON.parse(await readFile(match[1], "utf8"))).toEqual(data);
  } finally {
    await rm(join(match[1], ".."), { recursive: true, force: true });
  }
});
