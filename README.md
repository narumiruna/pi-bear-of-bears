# pi-bear-of-bears

Play 萬熊之熊 from [pi](https://pi.dev) through your Telegram **user account** and [@BearOfBearsBot](https://t.me/BearOfBearsBot). This extension uses MTProto through Teleproto—not a BotFather token.

- **Game tools:** read history, send commands, press supported buttons and browse the public map.
- **Live monitoring:** bring game-chat updates into pi without starting an agent turn.
- **Character widget:** view the latest recognized status above the editor.

> **Your Telegram session grants account access.** Run login in your own terminal. Never paste credentials, session contents, login codes or passwords into pi chat.

[Quickstart](#quickstart) · [Play](#play) · [Live monitoring](#live-monitoring) · [Character status](#character-status-widget) · [Configuration](#configuration) · [Security](#security-and-limitations) · [Development](#development)

## Quickstart

**Requirements:** Node.js 22.13+ and [pi](https://pi.dev) with the `@earendil-works` extension API. Verified with pi 0.85.1.

### 1. Log in to Telegram

Get **App api_id** and **App api_hash** from [Telegram Apps](https://my.telegram.org/apps), then run these commands **in your own terminal, not through an agent**:

```bash
git clone https://github.com/narumiruna/pi-bear-of-bears.git
cd pi-bear-of-bears
npm ci
npm run login
```

Follow the prompts for your API credentials, phone number, login code and optional two-step verification password. Login verifies your account and saves the session locally; it does not send a game command.

### 2. Start pi

From the project directory:

```bash
pi -ne -ns -np -nc -e .
```

Trust the project when pi asks. This loads the project's extensions and skill without saving a package installation.

The `-ne -ns -np -nc` flags disable automatic discovery of extensions, skills, prompt templates and context files. **This is not a sandbox:** built-in tools and Telegram account permissions remain available.

### 3. Start with a read-only task

```text
/skill:playing-bear-of-bears 先查看我的角色狀態，再建議下一步，暫時不要戰鬥或花錢。
```

For persistent installation or a custom session path, see [Configuration](#configuration).

## Play

Give the agent a clear scope and action limit. For example:

```text
探索附近區域，最多 5 個動作。不要進 BOSS 房、交易或發公開訊息。
```

### Available tools

| Tool | What it does |
| --- | --- |
| `bears_history` | Reads up to 30 recent messages, including button coordinates and revisions. Use `beforeId` for older pages. |
| `bears_send` | Sends one plain-text command to the game bot and briefly observes replies. |
| `bears_click` | Revalidates and presses a text/callback button by message ID, revision, row and column. |
| `bears_world` | Queries the public map by room ID or text, with pagination, exits, NPCs and safe/boss flags. No login required. |

### Action safety

- **Do not run multiple agents or manually issue gameplay actions while the agent is acting on the same account.** Manual commands while the agent is idle are supported by live monitoring.
- **Read history after an uncertain outcome; do not repeat the action.** Replies can be delayed, edited or unrelated, so submitting an action does not prove success.
- Telegram tools reject overlapping calls within one extension instance. Each operation has a 30-second deadline, waits about 1.5 seconds after an action for updates and closes its connection afterward.
- Reloading does not start background farming or automatically replay actions.

## Live monitoring

Monitoring starts automatically in interactive and RPC pi sessions using your saved login. The footer shows `watch: listening` when ready.

When you manually send `/status` in the game chat, pi receives your command and the bot's replies, including edits. Only the verified `@BearOfBearsBot` private conversation is forwarded; other chats are excluded.

| Command in pi | Effect |
| --- | --- |
| `/bears-watch status` | Checks monitoring status. |
| `/bears-watch off` | Stops monitoring. |
| `/bears-watch on` | Starts or restarts the connection. Use after login or a connection problem. |

Updates appear as `bears-watch` messages and enter model context **without starting an agent turn**. During an agent turn, insertion is deferred until the turn ends to preserve tool-call ordering. Watching does not send commands, press buttons or mark messages as read.

### Connection and update behavior

- Monitoring uses a separate read-only connection; tool connections still close after each operation.
- Connection loss is reported as `disconnected`; the SDK may reconnect automatically. Startup failure is reported once, without indefinite retries.
- Use `bears_history` to recover context after a gap. Missed events, deletions and historical messages are not guaranteed to be replayed.
- Updates are batched over 500 ms and identical revisions are deduplicated. Each batch keeps the latest 20 messages and reports how many were omitted. Tool output limits also apply.
- Session reload/replacement enables monitoring again, even if you turned it off. Shutdown and `/reload` cancel pending batches, remove handlers and close the connection.
- Print and JSON one-shot runs do not start monitoring automatically.

Continuous monitoring adds game text to your pi session and model context. Turn it off when not needed.

## Character status widget

The package automatically loads `extensions/character-status.ts`, which displays character and adventure observations **above the editor**, separated by horizontal dividers:

| Section | Observed source | Information |
| --- | --- | --- |
| Character | Complete `/status` response | Character/class/level, HP/MP, attributes, coins and EXP |
| Idle progress | Idle-start/progress reports and `/status` | Duration, locations visited, kills, reported gains and idle marker |
| Room | Room/movement replies, `/status`, idle reports | Latest location, observed exits, monsters/levels/counts and shop marker |
| Tasks | New-task/completion notifications | Latest objective or completion notice |
| Skills | Callback-button labels | Last observed skill names and MP costs, not cooldowns or guaranteed availability |
| Sync | Extension lifecycle and message stream | Monitoring state and latest message time |

Each observation retains its own message source and time. No background queries or game commands are added.
Values and modifiers are preserved as reported, including `含掛機預估`. Idle gains are never added to coins/EXP balances, combined across reports or treated as settled rewards.
Room details are hidden when a newer location refers to a different room; old monsters/exits are not carried over.
Missing information remains unknown, not a negative claim: a menu without skills does not prove skills are unavailable.
Only the observed message formats are parsed; unsupported task menus, idle settlement formats or cooldowns are not inferred.

### Refreshing status

On startup, the widget reads the latest 30 game-chat messages once, without sending commands. It then updates from live monitoring and game-tool results, independently of agent turns.

| Action | Result |
| --- | --- |
| Send `/status` manually in Telegram while the agent is idle | Requests a fresh status from the bot; monitoring updates the widget when the reply arrives. |
| Run `/bears-status` or `/bears-status refresh` in pi | Rereads recent history only. **Does not send `/status` to Telegram.** |
| Run `/bears-status compact` | Uses the default compact layout without a network request. |
| Run `/bears-status full` | Expands attributes, reports, task notices and skills without a network request. |

If no complete status response is found, request one in Telegram. The panel shows the status message time and flags newer activity; combat or movement messages do not overwrite individual stats with guesses.

### Display and lifecycle

The panel uses dividers and CJK/emoji-aware width handling. Compact mode fits observations onto single lines and is capped at 24 rows; full mode wraps details and is capped at 48 rows. Truncation is marked; use full mode or Telegram for longer content. RPC receives a plain-text version; one-shot modes do not automatically open the widget or query history.
Display mode resets to compact after reload.

Shutdown/reload removes the event subscription and UI. No separate character cache is persisted.

## Configuration

### Credentials and session storage

Login prompts for credentials that are not already configured. You can also supply them through process environment variables:

| Variable | Purpose | Default |
| --- | --- | --- |
| `TELEGRAM_API_ID` | **App api_id** from Telegram Apps | Saved credentials |
| `TELEGRAM_API_HASH` | **App api_hash** from Telegram Apps | Saved credentials |
| `BEARS_SESSION_FILE` | Session file path; use an absolute path outside the repository | `~/.config/bear-of-bears/session` |

Process environment variables override saved credentials; missing values are filled from the saved file. No dotenv files are loaded. Restart pi after changing environment variables.

If you set `BEARS_SESSION_FILE`, keep it set when launching pi. Otherwise, the extension uses the default location. Credentials saved at the default location also work when pi starts in another directory.

### What login saves

- The session and adjacent `session.credentials.json` use file mode `600`; newly created directories use mode `700`.
- Codes and passwords use masked prompts. Session contents are never printed, and your phone number, login code and two-step verification password are not saved.
- Existing sessions are verified and reused, never overwritten. Running login again can save credentials for an existing session without requesting another code.
- Existing credentials can be reused, but conflicting saved credentials are not overwritten automatically.

The extensions read credentials when monitoring starts, the widget reads history or a Telegram tool runs—not during extension factory loading. The public map needs no credentials.

### Other ways to load the package

**Install this checkout as a local pi package:**

```bash
pi install -l .
pi
```

**Or load the extensions and skill explicitly:**

```bash
pi -e ./extensions/bears.ts -e ./extensions/character-status.ts --skill ./skills/playing-bear-of-bears/SKILL.md
```

Trust the project when pi asks.

## Security and limitations

### Protect your account

- **A Telegram session grants account access.** Fixed-bot routing limits these tools, not the session's underlying permissions or other pi tools/extensions. Consider a dedicated account.
- Never paste credentials, session contents, login codes or passwords into pi chat. Game text and tool results enter model context and pi session history.
- Keep credentials and session files outside the repository and protect backups. If compromised, revoke access in Telegram **Settings → Devices**; deleting local files alone does not revoke access.
- To log in again, revoke the previous session and remove its local file before running `npm run login`.

### Know the boundaries

- URL, payment, authentication, phone and location buttons are blocked. Ordinary commands/callbacks can still spend in-game resources. **Purchase, trade and PvP approval rules are agent guidance, not a transaction firewall.**
- Messages expose text, buttons and a media-presence flag. Photos/files are not downloaded; use Telegram manually for images or unsupported interactions.
- Tool output is truncated at 45 KB/1800 lines, with full output saved in a private temporary directory. Delete those files when no longer needed.
- Public map snapshots update about every 12 seconds and can be stale. Routes may have game-specific prerequisites.
- Check the game's automation rules and respect Telegram rate limits.

### Verification status

Authenticated login has been reported successful by the user. **Live monitoring and gameplay have not been end-to-end verified with a real account.**

Offline tests cover adapter requests, cancellation, stale-button checks, configuration, output limits, monitoring lifecycle, character parsing/rendering and pi resource loading. The character parser was also checked against a real read-only `/status` history response; fixtures anonymize the character name.

## Development

Run the checks:

```bash
npm run ci
```

Tests use fake transports and HTTP responses; no credentials are required.

| Path | Responsibility |
| --- | --- |
| `extensions/bears.ts` | Tool registration |
| `extensions/character-status.ts` | Character status widget |
| `src/` | Configuration, login, Telegram transport, action coordination and public-map lookup |
| `skills/playing-bear-of-bears/SKILL.md` | Bounded, evidence-based play strategy |
