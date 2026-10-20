#!/usr/bin/env bash
set -euo pipefail

cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
export PI_CODING_AGENT_DIR="${PI_CODING_AGENT_DIR:-$PWD/.pi/agent}"
exec pi -ne -nc -ns -np \
  -e builtin:mcp \
  -e builtin:codemode \
  --tools +codemode \
  -e . \
  -e npm:@narumitw/pi-goal \
  -e npm:@narumitw/pi-caffeinate \
  -e npm:@narumitw/pi-starship \
  -e npm:@narumitw/pi-stamp \
  -e npm:@narumitw/pi-subagents \
  -e npm:@narumitw/pi-btw \
  "$@"
