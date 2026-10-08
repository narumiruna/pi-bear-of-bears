#!/usr/bin/env bash
set -euo pipefail

cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
exec pi -ne -nc -ns -np \
  -e builtin:mcp \
  -e . \
  -e npm:@narumitw/pi-goal \
  -e npm:@narumitw/pi-caffeinate \
  -e npm:@narumitw/pi-starship \
  "$@"
