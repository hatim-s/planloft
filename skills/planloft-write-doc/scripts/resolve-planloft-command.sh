#!/bin/sh
set -u

if planloft_path=$(command -v planloft 2>/dev/null); then
  printf '%s\n' "$planloft_path"
  exit 0
fi

printf '%s\n' \
  'Planloft CLI is required by the planloft-write-doc skill. Install it with `npm install -g planloft`, `pnpm add -g planloft`, or `bun add -g planloft`, then retry in a new agent session.' \
  >&2
exit 127
