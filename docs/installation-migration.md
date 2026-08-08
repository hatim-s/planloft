# Planloft installation migration

Planloft now has one semantic skill: `write-plan`. The removed skill names are
`save-doc`, `planloft-preview`, `planloft-copy`, and `planloft-deploy`. Preview, copy,
deploy, and non-plan storage remain CLI operations. There are no discoverable
compatibility stubs or deprecated aliases for the removed surface.

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

### Skills, slash aliases, and CLI replacements

- Remove the skills `save-doc`, `planloft-preview`, `planloft-copy`, and
  `planloft-deploy`; do not recreate them as wrappers or compatibility shims.
- Remove the Claude slash aliases `/planloft-preview`, `/planloft-copy`, and
  `/planloft-deploy`.
- Use `write-plan` for substantial agent-authored plans. Use explicit
  `planloft hoist <input>` for other existing Markdown, JSON, or trusted HTML sources.
- Replace the removed preview/copy/deploy skills and slash aliases with
  `planloft preview [slug]`, `planloft copy [slug]`, and `planloft deploy [slug]`.
- Install the CLI separately before a skill-only install. Installing `write-plan` alone
  does not install an executable, hook, theme, schema, or runtime asset.

### Markdown-only plan authoring

Agent write-direct plan capture is Markdown-only. Remove `planFormat` from
`~/.planloft/config.json`; `planFormat: "html"` now produces a migration diagnostic
rather than an HTML compatibility path. Keep authored Markdown presentation-neutral
and let the renderer supply the top theme toggle plus browser/system light-dark
preference. Existing explicitly trusted HTML input and already indexed legacy HTML can
still be rendered or deployed; this is not permission for agents to author new HTML
plans.

### Strict configuration and TTL

Configuration is a strict version-1 document. Malformed JSON, inaccessible files,
unsupported versions, unknown properties, invalid theme names or directories, and
invalid nested values fail with stable diagnostics instead of silently using defaults.
Defaults apply only when `config.json` is absent. `planloft config` validates the file
again after the editor closes.

TTL values from `--ttl` and `config.defaultTtlDays` must be finite positive integers no
greater than the schema/runtime maximum. Zero no longer means permanent, and the
configured default is used only when `--ttl` is omitted.

### Publication privacy and comments

Do not describe a Planloft deployment as private or secret. The URL path is hard to
guess and marked `noindex`, but the backing GitHub repository is public. Repository
visitors can enumerate document folders and manifest metadata. Keep sensitive plans
local.

Comments remain off by default. Before `--comments`, enable GitHub Discussions, install
or enable the giscus GitHub App for the selected public repository, select a supported
Discussion category, and configure all four effective fields: `giscus.repo`,
`giscus.repoId`, `giscus.category`, and `giscus.categoryId`. Planloft validates them
before rendering or Git operations.

### Public Node interface

Node callers that need complete CLI-equivalent operations should move to the async
`createPlanloftApplication()` interface and consume its structured results and
`PlanloftApplicationError` categories/codes instead of parsing terminal output.
`ingestDocument`, `hoistDocument`, and `renderDocument` remain supported focused
package-root exports. Historical `src/commands/*` modules were never public exports and
were removed without wrappers; update direct internal imports rather than adding
backward-compatibility shims.
