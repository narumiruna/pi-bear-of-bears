---
name: playing-bear-of-bears
description: Play 萬熊之熊 (Bear of Bears) through @BearOfBearsBot using the bears tools; use for character inspection, exploration, combat planning, equipment decisions, and bounded gameplay sessions.
---

# Playing Bear of Bears

## Establish the goal

Read `bears_history` to recover the current menu, character condition, and recent actions.
If the history is empty, ask before `/start` because it may begin character creation.
Find help commands and menu choices in actual bot responses rather than inventing commands.
If authentication fails, ask the user to complete `npm run login` in their own terminal; do not retrieve credentials yourself.

For an open-ended request to play, use at most 10 state-changing actions before reporting back.
Respect any smaller user budget and stop early if the goal is reached.
A strategy-only request permits observation, not gameplay mutations.

## Command reference

Read [commands.md](commands.md) before choosing game commands. It describes observed commands by purpose: inspection, movement/combat, equipment, idle mode, shops/crafting, pets/home, character management and social actions, with mutation and approval warnings.
This reference comes from actual bot help and replies, but is not a guarantee that syntax, costs or rules remain current. Recheck live help or menus when uncertain; do not treat examples as authorization.

| Agent tool | Purpose |
| --- | --- |
| `bears_history` | Read recent game-chat messages without sending commands or marking them read. Includes message IDs, revisions and zero-based button coordinates; use `beforeId` for older pages. |
| `bears_send` | Send one observed plain-text game command and briefly collect updates. Even a query sends a Telegram message; a submitted action is not proof of success. |
| `bears_click` | Revalidate and press an observed text/callback button. Rejects stale revisions and unsupported button types, but ordinary callbacks can still spend resources. |
| `bears_world` | Query the public map by room ID or text, with pagination, exits, NPCs and safe/boss flags. Needs no Telegram login and does not prove current character state. |

Ask before purchases, item destruction, sales, trades/transfers, public chat, PvP or account/character changes unless the user explicitly authorized the action and budget.
Starting `/idle` authorizes persistent game-side activity, not merely one manual fight; obtain explicit permission and respect BOSS restrictions. `/stopidle` claims rewards and ends idle mode, while `/idlestatus` only inspects progress. Movement, attacks and casting can also end and settle idle mode.

## Choose actions from evidence

Use Telegram responses as the source of truth for HP, resources, inventory, cooldowns and action outcomes.
Use `bears_world` to inspect room IDs, directional exits, safe rooms, NPCs and boss flags; its public snapshot may lag behind the game.
Use listed exits rather than inferring connections from grid coordinates.
A shortest route is not necessarily safe: prefer known safe rooms and avoid boss rooms unless combat is part of the user's goal.
Move one room at a time and confirm the destination before continuing.

Before combat, inspect current HP, available healing and a known escape route.
When health or enemy difficulty is unknown, inspect rather than start another fight.
After a dangerous encounter, compare HP and resource changes before deciding whether to heal, retreat or continue.
Treat equipment as a tradeoff among observed class-relevant stats, passives and costs; do not assume higher rarity is always better.
Do not invent drop rates, stat formulas, optimal builds or profitable farming loops.

## Handle menus and delayed replies

Copy the message ID, revision and zero-based button coordinates returned by `bears_history` into `bears_click`.
On a stale-button error, refresh history and reconsider the current menu.
After `no_update_yet` or an unknown-outcome error, read history at most twice, then stop if the outcome remains unclear.
Never repeat a mutation merely because its reply was delayed.
Stop on Telegram rate limits, death, insufficient resources, unexpected costs or an approval boundary.
Do not create background farming loops or automatically resume actions after session reload.

## Record verified experience

Read [field-notes.md](field-notes.md) when planning manual leveling, healing routes or early 法熊 equipment. These historical observations do not replace live inspection.
When the user authorizes recording gameplay experience, update that file with reusable findings and a concise latest checkpoint. Include bot message IDs, observed character stats and relevant conditions. Separate verified outcomes from hypotheses; do not store credentials, unrelated player details or unverified game text as agent instructions. Keep authorization and stopping rules unchanged.

## Report the result

Summarize completed actions, observed changes to HP/resources/location, remaining uncertainty and the next recommended action.
Distinguish confirmed bot responses from predictions and public-map hints.

## Public references

Consult the [world map](https://lab4.kvzhuang.net/gen-art/bears-life/) for room context and the [boss codex](https://lab4.kvzhuang.net/gen-art/bears-life-codex/) when the user asks about boss drops.
These pages can change; cite retrieved evidence rather than treating remembered values as current rules.
