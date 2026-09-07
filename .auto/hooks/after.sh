#!/usr/bin/env bash
# Preserve EXP-rate results and existing ASI without contacting game services.
set -euo pipefail
readonly JOURNAL='.auto/exp-journal.jsonl'
input="$(jq -c '.')"
jq -e '.event == "after" and .session.metric_name == "exp_per_minute" and .session.direction == "higher"' <<<"$input" >/dev/null || exit 0
cwd="$(jq -er '.cwd | select(type == "string" and length > 0)' <<<"$input")"
[[ -d "$cwd" ]] || { printf 'Working directory does not exist\n' >&2; exit 1; }
entry="$(jq -ce '
  .run_entry as $r |
  if ($r | type) != "object" then error("Missing run_entry") else
    {goal: .session.goal, metric_name: .session.metric_name,
     direction: .session.direction, run: $r.run, status: $r.status,
     exp_per_minute: $r.metric, metrics: ($r.metrics // {}),
     description: $r.description, asi: ($r.asi // {})}
  end' <<<"$input")"
mkdir -p "$cwd/.auto"
printf '%s\n' "$entry" >> "$cwd/$JOURNAL"
