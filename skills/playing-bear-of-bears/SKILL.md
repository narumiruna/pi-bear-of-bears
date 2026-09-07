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

## Report the result

Summarize completed actions, observed changes to HP/resources/location, remaining uncertainty and the next recommended action.
Distinguish confirmed bot responses from predictions and public-map hints.

## Public references

Consult the [world map](https://lab4.kvzhuang.net/gen-art/bears-life/) for room context and the [boss codex](https://lab4.kvzhuang.net/gen-art/bears-life-codex/) when the user asks about boss drops.
These pages can change; cite retrieved evidence rather than treating remembered values as current rules.
