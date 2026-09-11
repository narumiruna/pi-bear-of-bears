import { lstat } from "node:fs/promises";
import process from "node:process";
import { input, password } from "@inquirer/prompts";
import {
  credentials,
  credentialValues,
  readSession,
  sessionPath,
} from "./config.js";
import { loginError } from "./login-errors.js";
import { persistLogin } from "./login-session.js";
import { createClient } from "./telegram.js";

async function login() {
  if (!(process.stdin.isTTY && process.stdout.isTTY)) {
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
    if (error.code !== "ENOENT") {
      throw error;
    }
  });
  const session = existing ? await readSession(path) : "";
  const client = createClient(session, apiId, apiHash, "login");
  try {
    if (existing) {
      await client.connect().catch((error: unknown) => {
        throw new Error(loginError(error));
      });
    } else {
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
    }
    await persistLogin(client, path, api, Boolean(existing));
  } finally {
    await client.destroy();
  }
}

login().catch((_error: unknown) => {
  process.exitCode = 1;
});
