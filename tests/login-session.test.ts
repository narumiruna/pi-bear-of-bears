import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, vi } from "vitest";
import { readSession, savedCredentials, saveSession } from "../src/config.js";
import { persistLogin } from "../src/login-session.js";

test("verified existing sessions gain credentials without replacing their session", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bears-login-test-"));
  const path = join(directory, "session");
  const api = { apiId: 123, apiHash: "a".repeat(32) };
  const client = {
    checkAuthorization: async () => true,
    getMe: async () => ({ bot: false }),
    session: { save: vi.fn(() => "new-session") },
  };
  try {
    await saveSession(path, "existing-session");
    await persistLogin(client, path, api, true);
    expect(await readSession(path)).toBe("existing-session");
    expect(await savedCredentials({}, path)).toEqual(api);
    expect(client.session.save).not.toHaveBeenCalled();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("only authorized user login saves credentials and session", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bears-login-test-"));
  const path = join(directory, "session");
  const api = { apiId: 123, apiHash: "a".repeat(32) };
  const client = {
    checkAuthorization: vi.fn(async () => false),
    getMe: vi.fn(async () => ({ bot: true })),
    session: { save: () => "new-session" },
  };
  try {
    await expect(persistLogin(client, path, api, false)).rejects.toThrow(
      "not authorized",
    );
    await expect(savedCredentials({}, path)).rejects.toThrow("TELEGRAM_API_ID");
    client.checkAuthorization.mockResolvedValue(true);
    await expect(persistLogin(client, path, api, false)).rejects.toThrow(
      "user account",
    );
    await expect(savedCredentials({}, path)).rejects.toThrow("TELEGRAM_API_ID");
    client.getMe.mockResolvedValue({ bot: false });
    await persistLogin(client, path, api, false);
    expect(await readSession(path)).toBe("new-session");
    expect(await savedCredentials({}, path)).toEqual(api);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
