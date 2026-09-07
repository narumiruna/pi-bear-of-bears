# Bear of Bears Agent

A [pi](https://pi.dev) extension for playing 萬熊之熊 through your Telegram **user account** and [@BearOfBearsBot](https://t.me/BearOfBearsBot).
It uses MTProto through Teleproto, not a BotFather token.

## Setup

Requires Node.js 22.13+ and pi with the `@earendil-works` extension API; verified against pi 0.85.1.

```bash
npm ci
```

Get your application credentials from https://my.telegram.org/apps.
`npm run login` prompts for **App api_id** and **App api_hash**, matching the field names on Telegram's Apps page, when they are not already configured.
Optionally supply them through process environment variables instead:

| Telegram Apps field | Environment variable |
| --- | --- |
| App api_id | `TELEGRAM_API_ID` |
| App api_hash | `TELEGRAM_API_HASH` |

You can also set the `BEARS_SESSION_FILE` environment variable to an absolute path outside this repository.
The default is `~/.config/bear-of-bears/session`.

Run the login command **in your own terminal**, not through an agent tool:

```bash
npm run login
```

Enter your phone number, login code and optional two-step verification password.
Codes and passwords use masked prompts; the session is saved with mode `600`, without printing its contents.
After verifying the account, login saves API credentials alongside the session in `session.credentials.json`, also with mode `600`; newly created directories use mode `700`.
Existing session files are verified and reused, never overwritten, so running login again can save credentials for a previously logged-in account without requesting another code.
Existing credentials can be reused but conflicting saved credentials are not overwritten automatically.
Login does not send a game command and does not save your phone number, code or two-step verification password.
If you use a custom `BEARS_SESSION_FILE`, retain that path in the process environment; otherwise the extension will look at the default location.

Install this checkout as a local pi package:

```bash
pi install -l .
pi
```

Alternatively, load both resources explicitly:

```bash
pi -e ./extensions/bears.ts --skill ./skills/playing-bear-of-bears/SKILL.md
```

Trust the project when pi asks.
The extension reads credentials only when a Telegram tool runs; it does not read configuration or connect during extension loading.
Process environment variables override private saved credentials, with missing values filled from the saved file.
No dotenv files are loaded.
Restart pi after changing its environment variables.
Saved credentials at the default location work when launching pi in another directory.
The public map tool needs no credentials.

## Play

For example:

```text
/skill:playing-bear-of-bears 先查看我的角色狀態，再建議下一步，暫時不要戰鬥或花錢。
```

Or authorize a bounded task:

```text
探索附近區域，最多 5 個動作。不要進 BOSS 房、交易或發公開訊息。
```

| Tool | Operation |
| --- | --- |
| `bears_history` | Read up to 30 recent messages with button coordinates and revisions; use `beforeId` for older pages. |
| `bears_send` | Send one plain-text command to the game bot and observe replies briefly. |
| `bears_click` | Revalidate and press a text/callback button using its message ID, revision, row and column. |
| `bears_world` | Query the public map by room ID or text, with pagination, exits, NPCs and safe/boss flags. |

Telegram tools reject overlapping calls within one extension instance and close their connection after each operation.
Operations have a 30-second deadline and wait about 1.5 seconds after an action before reading updates.
Do not run multiple agents or manually play concurrently with this extension on the same account.
Replies can be delayed, edited or unrelated: a submitted action is not proof of success.
Read history after uncertain outcomes rather than repeating the action.
No background farming or automatic replay occurs after reload.

## Security and limitations

- **A Telegram session grants account access.** Fixed-bot routing limits these tools, not the session's underlying permissions or other pi tools/extensions; consider a dedicated account.
- Never paste saved credentials, session contents, login codes or passwords into pi chat. Game text and tool results enter the model context and pi session history.
- Keep credentials and the session file outside the repository, protect backups, and revoke access in Telegram **Settings → Devices** if compromised. Deleting the local file alone does not revoke it.
- To log in again, revoke the previous session and remove its local file before running `npm run login`.
- The tools reject URL, payment, authentication, phone and location buttons. Ordinary commands/callbacks can still spend in-game resources; purchase/trade/PvP approval rules are agent guidance, not a game transaction firewall.
- Messages expose text, buttons and a media-presence flag; photos/files are not downloaded. Use Telegram manually when an image or unsupported interaction is required.
- Large tool output is truncated at 45 KB/1800 lines and saved in a private temporary directory; delete those files when no longer needed.
- Public map snapshots update about every 12 seconds and can be stale. Routes may have game-specific prerequisites.
- Check the game's automation rules and respect Telegram rate limits.

Authenticated login and live gameplay have **not** been tested with a real account.
Offline tests verify adapter requests, cancellation, stale-button checks, configuration, output limits and pi resource loading.

## Development

```bash
npm run ci
```

`extensions/bears.ts` registers tools; `src/` contains configuration, login, Telegram transport, action coordination and public-map lookup.
`skills/playing-bear-of-bears/SKILL.md` provides bounded, evidence-based play strategy.
Tests use fake transports and HTTP responses and do not require credentials.
