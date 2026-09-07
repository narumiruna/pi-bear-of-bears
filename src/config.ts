import { constants } from "node:fs";
import { type FileHandle, mkdir, open } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export function credentials(env: NodeJS.ProcessEnv = process.env) {
  const apiId = Number(env.TELEGRAM_API_ID);
  const apiHash = env.TELEGRAM_API_HASH ?? "";
  if (
    !Number.isSafeInteger(apiId) ||
    apiId <= 0 ||
    !/^[a-f\d]{32}$/i.test(apiHash)
  ) {
    throw new Error(
      "Set TELEGRAM_API_ID and TELEGRAM_API_HASH from my.telegram.org/apps.",
    );
  }
  return { apiId, apiHash };
}

export function sessionPath(env: NodeJS.ProcessEnv = process.env) {
  const path =
    env.BEARS_SESSION_FILE ?? join(getAgentDir(), "bear-of-bears", "session");
  if (!isAbsolute(path))
    throw new Error("BEARS_SESSION_FILE must be an absolute path.");
  return path;
}

export async function readSession(path: string) {
  let file: FileHandle | undefined;
  try {
    file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = await file.stat();
    if (!stat.isFile() || (stat.mode & 0o077) !== 0) {
      throw new Error("Session must be a regular file with permissions 600.");
    }
    const value = (await file.readFile("utf8")).trim();
    if (!value) throw new Error("Session file is empty. Run npm run login.");
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw Object.assign(
        new Error("No Telegram session. Run npm run login outside pi first."),
        { code: "ENOENT" },
      );
    }
    throw error;
  } finally {
    await file?.close();
  }
}

export function credentialsPath(path = sessionPath()) {
  return `${path}.credentials.json`;
}

export async function credentialValues(
  env: NodeJS.ProcessEnv = process.env,
  path = sessionPath(env),
): Promise<NodeJS.ProcessEnv> {
  if (env.TELEGRAM_API_ID && env.TELEGRAM_API_HASH) return env;
  let saved: ReturnType<typeof credentials> | undefined;
  try {
    const text = await readSession(credentialsPath(path));
    try {
      const value = JSON.parse(text);
      if (
        typeof value?.apiId !== "number" ||
        typeof value?.apiHash !== "string"
      )
        throw new Error("Invalid credentials schema.");
      saved = credentials({
        TELEGRAM_API_ID: String(value.apiId),
        TELEGRAM_API_HASH: value.apiHash,
      });
    } catch {
      throw new Error(
        "Saved Telegram credentials are invalid. Run npm run login with valid API credentials.",
      );
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return {
    TELEGRAM_API_ID:
      env.TELEGRAM_API_ID || (saved ? String(saved.apiId) : undefined),
    TELEGRAM_API_HASH: env.TELEGRAM_API_HASH || saved?.apiHash,
  };
}

export async function savedCredentials(
  env: NodeJS.ProcessEnv = process.env,
  path = sessionPath(env),
) {
  return credentials(await credentialValues(env, path));
}

export async function saveCredentials(
  path: string,
  value: ReturnType<typeof credentials>,
) {
  const file = credentialsPath(path);
  const text = JSON.stringify(
    credentials({
      TELEGRAM_API_ID: String(value.apiId),
      TELEGRAM_API_HASH: value.apiHash,
    }),
  );
  try {
    await saveSession(file, text);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    if ((await readSession(file)) !== text) {
      throw new Error(
        "Saved API credentials differ. Back up and remove the credentials file before replacing it; the session was not overwritten.",
      );
    }
  }
}

export async function saveSession(path: string, value: string) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  // Refuse overwrites and symlinks rather than replacing an existing account.
  const file = await open(path, "wx", 0o600);
  try {
    await file.writeFile(value, "utf8");
  } finally {
    await file.close();
  }
}
