import { lstat } from "node:fs/promises";
import { input, password } from "@inquirer/prompts";
import {
  credentials,
  credentialsPath,
  credentialValues,
  readSession,
  sessionPath,
} from "./config.js";
import { loginError } from "./login-errors.js";
import { persistLogin } from "./login-session.js";
import { createClient } from "./telegram.js";

async function login() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error(
      "Run npm run login in your own interactive terminal, outside the agent.",
    );
  }
  const path = sessionPath();
  const values = await credentialValues(process.env, path);
  const api = credentials({
    TELEGRAM_API_ID:
      values.TELEGRAM_API_ID ||
      (await input({ message: "App api_id (https://my.telegram.org/apps):" })),
    TELEGRAM_API_HASH:
      values.TELEGRAM_API_HASH ||
      (await password({
        message: "App api_hash (https://my.telegram.org/apps):",
        mask: "*",
      })),
  });
  const { apiId, apiHash } = api;
  const existing = await lstat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
    return undefined;
  });
  const session = existing ? await readSession(path) : "";
  const client = createClient(session, apiId, apiHash, "login");
  try {
    if (existing) {
      await client.connect().catch((error: unknown) => {
        throw new Error(loginError(error));
      });
    } else
      await client
        .start({
          phoneNumber: () =>
            input({
              message: "Telegram phone number (including country code):",
            }),
          phoneCode: () =>
            password({ message: "Telegram login code:", mask: "*" }),
          password: () =>
            password({
              message: "Telegram two-step verification password:",
              mask: "*",
            }),
          onError: (error) => {
            throw error;
          },
        })
        .catch((error: unknown) => {
          throw new Error(loginError(error));
        });
    await persistLogin(client, path, api, Boolean(existing));
    console.log(
      `Login verified. Session: ${path}. App api_id / App api_hash: ${credentialsPath(path)}. Files use permissions 600. No game command was sent.`,
    );
    console.log(
      "App api_id and App api_hash are now saved locally. Keep BEARS_SESSION_FILE configured if you use a custom session path.",
    );
  } finally {
    await client.destroy();
  }
}

login().catch((error: unknown) => {
  // Avoid dumping Telegram request objects or account data.
  console.error(
    error instanceof Error ? error.message : "Telegram login failed.",
  );
  process.exitCode = 1;
});
