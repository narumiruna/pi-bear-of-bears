#!/usr/bin/env bash
# Remind the agent of EXP-rate measurement controls; never perform gameplay.
set -euo pipefail
input="$(jq -c '.' )"
jq -e '.event == "before" and .session.metric_name == "exp_per_minute" and .session.direction == "higher"' <<<"$input" >/dev/null || exit 0
printf '%s\n' \
  'EXP/min check: use the same predeclared observation duration; change only one strategy variable.' \
  'Measure newly earned EXP / elapsed wall-clock minutes, including movement, equipment changes and rest. Do not subtract within-level EXP across level-ups.' \
  'Manual gameplay only: never start or restart idle mode, including through character switching. Stop and settle existing idle mode. Record level/equipment changes; never count a report twice.' \
  'Record strategy, timestamps, evidence and confounders in normal description/ASI. Short or rounded-time samples are provisional, not proven improvements.' \
  'Hooks do not authorize gameplay. Use bears tools sequentially with observed commands; no background farming, automatic resume, or unapproved purchases, sales or advancement. Game state cannot be reverted by Git.'
