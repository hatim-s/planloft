# ADR-0004 — add Codex plugin support

- **Status**: Accepted
- **Date**: 2026-07-03
- **Amends**: ADR-0001 §D1, §D6, §D16.

---

## Context

planloft started as a Claude Code plugin plus bundled CLI. The core architecture already
keeps reusable behavior in the Node CLI (`resolve`, `preview`, `copy`, `deploy`), with
the plugin layer acting as activation glue: skills, commands, and hooks.

Codex has the same useful skill/plugin shape but a different plugin contract:

- Plugin metadata lives in `.codex-plugin/plugin.json`.
- Skills are discovered from `skills/`.
- Lifecycle hooks can be bundled with plugins via `hooks/hooks.json`.
- Slash commands are not accepted in the Codex plugin manifest.

## Decision

Ship a Codex plugin manifest alongside the Claude manifest and reuse the same `skills/`
directory.

Codex support has five skills:

- `write-plan` — persist substantial implementation/design plans through
  `planloft resolve --kind plan`.
- `save-doc` — persist durable non-plan docs through `planloft resolve --kind <kind>`.
- `planloft-preview` — run `planloft preview [slug]`.
- `planloft-copy` — run `planloft copy [slug]`.
- `planloft-deploy` — run `planloft deploy [slug] [flags]`.

The Claude slash command files remain in `commands/` for Claude Code. Codex gets
equivalent command-like behavior as skills, because that is the portable Codex plugin
surface today.

The shared `hooks/hooks.json` now supports both runtimes:

- `PostToolUse` on `Write` keeps normalizing files written under the planloft store.
- Claude Code's `ExitPlanMode` still injects a planloft save nudge.
- Codex has no explicit `PlanModeExit` hook event, so planloft uses Codex `Stop` input
  where `permission_mode === "plan"` and the last assistant message looks like a
  substantive plan. The hook blocks once per turn with a continuation reason so the
  agent can save the plan through `write-plan`.
- Codex `PostToolUse` on `Write`/`Edit` in plan mode also injects a once-per-turn
  reminder.

## Consequences

- The CLI remains the source of truth. No duplicated deploy/copy/render logic enters
  plugin-specific files.
- The npm package includes `.codex-plugin` in addition to `.claude-plugin`.
- Existing capture skills stay cross-runtime: they describe the same `planloft resolve`
  write path and avoid runtime-specific file-writing wording where possible.
- Hook state stores lightweight once-per-turn markers under `~/.planloft/hook-state/`
  to avoid repeated plan-mode stop loops.

## Rejected

- **Fork separate Codex skills under another directory** — the Codex manifest expects
  the plugin skill contract at `skills/`, and a fork would drift immediately.
- **Move command behavior into new TypeScript code** — preview/copy/deploy already live
  in the CLI; command skills should only call that stable surface.
- **Put hooks in `.codex-plugin/plugin.json`** — current Codex plugin examples and docs
  support bundled hook files; keeping lifecycle config in `hooks/hooks.json` preserves
  the existing Claude plugin layout and avoids manifest schema drift.
