const RPC_CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,79}$/;
const RETRY_EXHAUSTED_PATTERN = /^Request was unsuccessful \d+ time\(s\)$/;

const hints: Record<string, string> = {
  API_ID_INVALID:
    "Check App api_id and App api_hash at https://my.telegram.org/apps.",
  API_ID_PUBLISHED_FLOOD:
    "This API application is restricted. Use your own Telegram application credentials.",
  PHONE_NUMBER_INVALID: "Check the phone number, including its country code.",
  PHONE_NUMBER_BANNED:
    "Telegram has banned this phone number; contact Telegram support.",
  PHONE_CODE_INVALID:
    "The login code is incorrect. Restart login and use the latest code.",
  PHONE_CODE_EXPIRED:
    "The login code expired. Restart login to request a new code.",
  PASSWORD_HASH_INVALID: "The two-step verification password is incorrect.",
  AUTH_RESTART: "Telegram requested a fresh login. Try again later.",
};

interface LoginErrorValue {
  errorMessage?: unknown;
  seconds?: unknown;
  message?: unknown;
  code?: unknown;
  name?: unknown;
}

function asLoginErrorValue(error: unknown): LoginErrorValue {
  if (error && typeof error === "object") {
    return error as LoginErrorValue;
  }
  return {};
}

function rpcCode(value: LoginErrorValue): string | undefined {
  if (
    typeof value.errorMessage === "string" &&
    RPC_CODE_PATTERN.test(value.errorMessage)
  ) {
    return value.errorMessage;
  }
  return undefined;
}

function floodWait(value: LoginErrorValue): string {
  if (
    typeof value.seconds === "number" &&
    Number.isFinite(value.seconds) &&
    value.seconds > 0
  ) {
    return ` Wait at least ${value.seconds} seconds.`;
  }
  return " Wait before trying again.";
}

// Only expose structured RPC codes and known local failures, never raw messages
// that could contain a phone number, request payload, password or session.
export function loginError(error: unknown): string {
  const value = asLoginErrorValue(error);
  const code = rpcCode(value);
  if (
    code?.startsWith("FLOOD_WAIT") ||
    code?.startsWith("FLOOD_PREMIUM_WAIT")
  ) {
    return `Telegram login failed (${code}).${floodWait(value)} Do not repeatedly request codes.`;
  }
  if (code) {
    return `Telegram login failed (${code}). ${hints[code] ?? "Check Telegram's login requirements before retrying."}`;
  }
  if (
    typeof value.message === "string" &&
    RETRY_EXHAUSTED_PATTERN.test(value.message)
  ) {
    return "Telegram login request exhausted its retries, possibly during a data-center migration. Try again later.";
  }
  if (
    [
      "ETIMEDOUT",
      "ECONNREFUSED",
      "ECONNRESET",
      "ENETUNREACH",
      "EHOSTUNREACH",
    ].includes(String(value.code))
  ) {
    return `Telegram connection failed (${value.code}). Check your network connection.`;
  }
  if (value.name === "ExitPromptError" || value.name === "AbortPromptError") {
    return "Telegram login cancelled.";
  }
  return "Telegram login failed without a recognized RPC code. No credentials or request details were printed.";
}
