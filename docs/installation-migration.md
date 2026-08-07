# Planloft installation migration

Planloft now has one semantic skill: `write-plan`. Preview, copy, deploy, and non-plan
storage remain CLI operations. There are no discoverable compatibility stubs for the
four removed skills.

## Remove stale standalone skills

Run these commands from the project whose installation you are cleaning. Project scope
is the default; add `-g` for global scope. Pick the target explicitly with `-a codex` or
`-a claude-code`. The same removal commands handle installer-managed symlinks and
`--copy` installs.

```bash
npx skills remove save-doc planloft-preview planloft-copy planloft-deploy -a codex -y
npx skills remove save-doc planloft-preview planloft-copy planloft-deploy -a claude-code -y

# Repeat for user-global copies when applicable:
npx skills remove save-doc planloft-preview planloft-copy planloft-deploy -g -a codex -y
npx skills remove save-doc planloft-preview planloft-copy planloft-deploy -g -a claude-code -y
```

Then install the CLI and the remaining skill using one paired recipe from the README.
Use `pnpm dlx skills` or `bunx skills` in place of `npx skills` if that is how the old
installation was managed.

## Manual standalone cleanup

Only use manual cleanup after `skills remove` cannot locate a stale installation. Remove
the four retired directory names, never the parent skills directory and never
`write-plan`:

| Scope | Codex/universal paths | Claude Code path |
|---|---|---|
| Project | `.agents/skills/<retired-name>` and legacy `.codex/skills/<retired-name>` | `.claude/skills/<retired-name>` |
| Global | `~/.agents/skills/<retired-name>` and legacy `~/.codex/skills/<retired-name>` | `~/.claude/skills/<retired-name>` |

Inspect `skills-lock.json` in the project and any installer lockfile beside a global
canonical skill directory. Prefer a fresh `skills add` after cleanup so the external
installer rewrites its own metadata; do not hand-edit lockfiles unless the installer is
already unable to repair them.

## Upgrade or remove a full plugin

Standalone skill cleanup does not uninstall a plugin. A full plugin has its own cache,
enabled state, hooks, metadata, and npm runtime.

For Codex:

```bash
codex plugin remove planloft
codex plugin marketplace upgrade planloft
codex plugin add planloft@planloft
```

For Claude Code:

```bash
claude plugin uninstall planloft@planloft
claude plugin marketplace update planloft
claude plugin install planloft@planloft --scope user
```

Use `--scope project` or `--scope local` for the matching Claude installation. If an
old manually loaded plugin is not registered, remove only its Planloft plugin directory
and Planloft marketplace entry from the relevant repo/user configuration, then restart
the agent. Do not delete a shared plugin cache or marketplace catalog wholesale.

## Behavior migrations

- Replace retired preview/copy/deploy skills or slash aliases with `planloft preview`,
  `planloft copy`, and `planloft deploy`.
- Replace `save-doc` with explicit `planloft hoist <input>`.
- Agent-authored plans are Markdown. Remove the retired `planFormat` config property.
- Malformed or invalid configuration now fails instead of silently using defaults.
- TTL is a finite positive integer; zero is not permanent.
- GitHub Pages output is public and enumerable even when its path is hard to guess and
  marked `noindex`.
- Comments require complete giscus repository/category configuration.
