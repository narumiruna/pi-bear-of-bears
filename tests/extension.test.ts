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
      "bears_optimize_equipment",
      "bears_original",
    ]);
    expect(result.extensions[0].handlers.has("session_shutdown")).toBe(true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("pi 載入 Auto Idle extension 時不登入或連線", async () => {
  const directory = await mkdtemp(
    join(tmpdir(), "bears-auto-idle-loader-test-"),
  );
  try {
    const result = await discoverAndLoadExtensions(
      [resolve("extensions/auto-idle.ts")],
      directory,
      directory,
    );
    expect(result.errors).toEqual([]);
    expect(result.extensions).toHaveLength(1);
    expect([...result.extensions[0].tools.keys()]).toEqual([
      "start_idle",
      "stop_idle",
    ]);
    expect(result.extensions[0].commands.has("idle")).toBe(true);
    expect(result.extensions[0].commands.has("stopidle")).toBe(true);
    expect(result.extensions[0].handlers.has("session_shutdown")).toBe(true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("pi 載入 status extension 時提供 update_status 且不啟動連線", async () => {
  const directory = await mkdtemp(join(tmpdir(), "status-loader-test-"));
  try {
    const result = await discoverAndLoadExtensions(
      [resolve("extensions/status.ts")],
      directory,
      directory,
    );
    expect(result.errors).toEqual([]);
    expect(result.extensions).toHaveLength(1);
    expect([...result.extensions[0].tools.keys()]).toEqual(["update_status"]);
    expect(result.extensions[0].commands.size).toBe(0);
    expect(result.extensions[0].handlers.has("session_start")).toBe(true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("pi 載入上下文精簡 extension，不啟動連線", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bears-compact-loader-test-"));
  try {
    const result = await discoverAndLoadExtensions(
      [resolve("extensions/compact-context.ts")],
      directory,
      directory,
    );
    expect(result.errors).toEqual([]);
    expect(result.extensions).toHaveLength(1);
    expect(result.extensions[0].handlers.has("context")).toBe(true);
    expect(result.extensions[0].tools.size).toBe(0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("pi discovers the configured skills without diagnostics", () => {
  const results = ["bears-equipment-strategy", "playing-bear-of-bears"].map(
    (directory) =>
      loadSkillsFromDir({
        dir: resolve("skills", directory),
        source: "test",
      }),
  );
  expect(results.flatMap((result) => result.diagnostics)).toEqual([]);
  expect(
    results
      .flatMap((result) => result.skills.map((skill) => skill.name))
      .sort(),
  ).toEqual(["bears-equipment-strategy", "playing-bear-of-bears"]);
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
