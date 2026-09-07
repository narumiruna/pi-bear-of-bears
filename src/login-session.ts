import { type credentials, saveCredentials, saveSession } from "./config.js";
import { loginError } from "./login-errors.js";

interface AuthorizedClient {
  checkAuthorization(): Promise<boolean>;
  getMe(): Promise<{ bot?: boolean }>;
  session: { save(): unknown };
}

export async function persistLogin(
  client: AuthorizedClient,
  path: string,
  api: ReturnType<typeof credentials>,
  existing: boolean,
) {
  const authorized = await client
    .checkAuthorization()
    .catch((error: unknown) => {
      throw new Error(loginError(error));
    });
  if (!authorized)
    throw new Error(
      "Telegram session is not authorized. Revoke it and remove the session file before logging in again.",
    );
  const me = await client.getMe().catch((error: unknown) => {
    throw new Error(loginError(error));
  });
  if (me.bot)
    throw new Error("A Telegram user account is required, not a bot account.");
  await saveCredentials(path, api);
  if (!existing) await saveSession(path, String(client.session.save()));
}
