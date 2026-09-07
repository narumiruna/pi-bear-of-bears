import { chmod, mkdtemp, readFile, rm, stat, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import {
  credentials,
  credentialsPath,
  credentialValues,
  readSession,
  saveCredentials,
  savedCredentials,
  saveSession,
  sessionPath,
} from "../src/config.js";

const directories: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function path() {
  const directory = await mkdtemp(join(tmpdir(), "bears-test-"));
  directories.push(directory);
  return join(directory, "private", "session");
}

test("saved credentials work without environment variables and retain private permissions", async () => {
  const file = await path();
  const api = { apiId: 123, apiHash: "a".repeat(32) };
  await saveCredentials(file, api);
  expect(await savedCredentials({}, file)).toEqual(api);
  expect((await stat(credentialsPath(file))).mode & 0o777).toBe(0o600);
  expect((await stat(join(file, ".."))).mode & 0o777).toBe(0o700);
  await expect(saveCredentials(file, api)).resolves.toBeUndefined();
  await expect(saveCredentials(file, { ...api, apiId: 456 })).rejects.toThrow(
    "differ",
  );
  expect(await savedCredentials({}, file)).toEqual(api);
});

test("environment overrides saved values and missing values can be prompted", async () => {
  const file = await path();
  expect(await credentialValues({}, file)).toEqual({
    TELEGRAM_API_ID: undefined,
    TELEGRAM_API_HASH: undefined,
  });
  await saveCredentials(file, { apiId: 123, apiHash: "a".repeat(32) });
  expect(await savedCredentials({ TELEGRAM_API_ID: "456" }, file)).toEqual({
    apiId: 456,
    apiHash: "a".repeat(32),
  });
  expect(
    await savedCredentials(
      { TELEGRAM_API_ID: "789", TELEGRAM_API_HASH: "b".repeat(32) },
      file,
    ),
  ).toEqual({ apiId: 789, apiHash: "b".repeat(32) });
});

test("malformed or public credential files fail without disclosing their contents", async () => {
  const file = await path();
  await saveSession(credentialsPath(file), "secret-invalid-json");
  await expect(savedCredentials({}, file)).rejects.toThrow(
    "Saved Telegram credentials are invalid",
  );
  await chmod(credentialsPath(file), 0o644);
  await expect(savedCredentials({}, file)).rejects.toThrow("600");
});

test("requires Telegram application credentials, not bot tokens", () => {
  expect(() => credentials({})).toThrow("TELEGRAM_API_ID");
  expect(() =>
    credentials({ TELEGRAM_API_ID: "1.5", TELEGRAM_API_HASH: "a".repeat(32) }),
  ).toThrow();
  expect(
    credentials({ TELEGRAM_API_ID: "123", TELEGRAM_API_HASH: "a".repeat(32) }),
  ).toEqual({ apiId: 123, apiHash: "a".repeat(32) });
});

test("session paths are absolute and do not expand tilde", () => {
  expect(() => sessionPath({ BEARS_SESSION_FILE: "~/session" })).toThrow(
    "absolute",
  );
  expect(sessionPath({ BEARS_SESSION_FILE: "/tmp/session" })).toBe(
    "/tmp/session",
  );
  vi.stubEnv("PI_CODING_AGENT_DIR", "/tmp/custom-pi-agent");
  expect(sessionPath({})).toBe("/tmp/custom-pi-agent/bear-of-bears/session");
  vi.stubEnv("BEARS_SESSION_FILE", "/tmp/custom-session");
  expect(credentialsPath()).toBe("/tmp/custom-session.credentials.json");
});

test("預設憑證與 session 同目錄且跟隨 pi agent 設定", () => {
  vi.stubEnv("PI_CODING_AGENT_DIR", "/tmp/custom-pi-agent");
  vi.stubEnv("BEARS_SESSION_FILE", undefined);
  expect(credentialsPath()).toBe(
    "/tmp/custom-pi-agent/bear-of-bears/session.credentials.json",
  );
});

test("session writes are private and cannot overwrite an existing session", async () => {
  const file = await path();
  await saveSession(file, "test-secret");
  expect((await stat(file)).mode & 0o777).toBe(0o600);
  expect(await readSession(file)).toBe("test-secret");
  await expect(saveSession(file, "replacement")).rejects.toThrow();
  expect(await readFile(file, "utf8")).toBe("test-secret");
});

test("rejects permissive files, missing sessions and symlinks", async () => {
  const file = await path();
  await expect(readSession(file)).rejects.toThrow("npm run login");
  await saveSession(file, "test-secret");
  await chmod(file, 0o644);
  await expect(readSession(file)).rejects.toThrow("600");
  await symlink(file, `${file}-link`);
  await expect(readSession(`${file}-link`)).rejects.toThrow();
});
