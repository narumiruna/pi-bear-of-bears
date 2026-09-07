import { expect, test } from "vitest";
import { loginError } from "../src/login-errors.js";
import { createClient } from "../src/telegram.js";

test("login errors show structured Telegram codes with actionable hints", () => {
  expect(loginError({ errorMessage: "API_ID_INVALID" })).toContain(
    "App api_id and App api_hash",
  );
  expect(loginError({ errorMessage: "PHONE_NUMBER_INVALID" })).toContain(
    "country code",
  );
  expect(loginError({ errorMessage: "FLOOD_WAIT", seconds: 90 })).toContain(
    "90 seconds",
  );
  expect(loginError({ errorMessage: "SOME_NEW_RPC_CODE" })).toContain(
    "SOME_NEW_RPC_CODE",
  );
  expect(loginError(new Error("Request was unsuccessful 1 time(s)"))).toContain(
    "data-center migration",
  );
});

test("diagnostics do not echo raw messages or request data", () => {
  const secret = "private-value-not-for-output";
  expect(
    loginError({ message: secret, request: { phoneNumber: secret } }),
  ).not.toContain(secret);
  expect(loginError({ errorMessage: `FAIL ${secret}` })).not.toContain(secret);
  expect(loginError(null)).toContain("without a recognized RPC code");
});

test("login permits DC migration retries but gameplay does not", async () => {
  const game = createClient("", 123, "a".repeat(32));
  const login = createClient("", 123, "a".repeat(32), "login");
  try {
    expect(game._requestRetries).toBe(1);
    expect(login._requestRetries).toBe(3);
    expect(login.floodSleepThreshold).toBe(0);
  } finally {
    await game.destroy();
    await login.destroy();
  }
});
