#!/bin/sh
set -u

for plugin_root in "${PLUGIN_ROOT:-}" "${CLAUDE_PLUGIN_ROOT:-}"; do
  if [ -n "$plugin_root" ] && [ -x "$plugin_root/bin/planloft" ]; then
    printf '%s\n' "$plugin_root/bin/planloft"
    exit 0
  fi
done

skill_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
plugin_root=$(CDPATH= cd -- "$skill_dir/../.." && pwd)
if [ -x "$plugin_root/bin/planloft" ]; then
  printf '%s\n' "$plugin_root/bin/planloft"
  exit 0
fi

if planloft_path=$(command -v planloft 2>/dev/null); then
  printf '%s\n' "$planloft_path"
  exit 0
fi

printf '%s\n' \
  'Planloft CLI is required by the write-plan skill. Install it with `npm install -g planloft`, `pnpm add -g planloft`, or `bun add -g planloft`, then retry in a new agent session.' \
  >&2
exit 127
