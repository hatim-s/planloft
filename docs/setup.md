# Set up Planloft

Planloft setup has one command: `planloft init`. Installation puts the CLI and any
selected agent skills in place; initialization creates or validates local configuration
and reports whether GitHub publication is ready.

## Humans

Install the CLI with one package manager:

```bash
npm install -g planloft
# or: pnpm add -g planloft
# or: bun add -g planloft
```

Then initialize Planloft:

```bash
planloft init
```

The command is safe to run again. It creates `~/.planloft/config.json` only when the
file is absent, validates an existing file, reports the active theme and default TTL,
and checks whether the authenticated GitHub CLI is available. It does not install an
agent skill, change a repository, or publish a document.

To recover from stale or invalid configuration, run `planloft init --force`. This
explicitly replaces only `config.json` with the current exact defaults, including
removing any configured credentials. Stored documents, the index, custom themes,
hosting clones, and project files are preserved.

No configuration editing is required for local writing, storage, rendering, or
previewing.

## Agents

The optional `planloft-write-doc` skill teaches coding agents when and how to persist a
substantial document. Install it after the CLI, targeting exactly one agent:

| Target | Project install | Global install |
|---|---|---|
| Codex | `npx skills add hatim-s/planloft --skill planloft-write-doc -a codex` | `npx skills add hatim-s/planloft --skill planloft-write-doc -g -a codex` |
| Claude Code | `npx skills add hatim-s/planloft --skill planloft-write-doc -a claude-code` | `npx skills add hatim-s/planloft --skill planloft-write-doc -g -a claude-code` |
| Pi | `npx skills add hatim-s/planloft --skill planloft-write-doc -a pi` | `npx skills add hatim-s/planloft --skill planloft-write-doc -g -a pi` |

Use project scope by default so the repository declares its agent behavior. Use global
scope only when every project for that agent should discover the skill.

With pnpm, replace `npx skills` with `pnpm dlx skills`. With Bun, replace it with
`bunx skills`. Restart the target agent after installation so it reloads skill
discovery.

Planloft also ships `planloft-customise` for questions about the document pipeline and
custom theme work. Install it independently by replacing `planloft-write-doc` with
`planloft-customise` in the matching command above.

| Host | Authoring skill | Customisation skill |
|---|---|---|
| Codex | `planloft:write-doc` | `planloft:customise` |
| Claude Code | `/planloft-write-doc` | `/planloft-customise` |
| Pi | `/skill:planloft-write-doc` | `/skill:planloft-customise` |
| Other Agent Skills hosts | `planloft-write-doc` | `planloft-customise` |

Codex can preserve colon-qualified product labels through `agents/openai.yaml`. Claude,
Pi, and most other hosts derive identity from the portable folder and frontmatter name,
which allows lowercase letters, digits, and hyphens only.

An agent setting up an already installed environment only needs to run:

```bash
command -v planloft
planloft init
```

If `command -v` fails, install the CLI before invoking the skill. The skill-only
installer does not install the executable, themes, or runtime assets.

## CI

Use the same initialization command with a temporary or persisted Planloft home:

```bash
planloft init
```

Install the skill noninteractively only when CI needs to inspect or package agent
discovery files:

```bash
npx --yes skills add hatim-s/planloft --skill planloft-write-doc -a codex -y
```

Ordinary render and validation jobs need only the CLI. Publication jobs must provide a
GitHub credential through an authenticated `gh` CLI or `PLANLOFT_GITHUB_TOKEN`.
Noninteractive runs never prompt for a token.

## Verify

```bash
planloft --version
planloft init
planloft help
```

For a local smoke test:

```bash
printf '# Setup check\n' | planloft render - --format md --out ./planloft-setup-check
```

The output is local HTML. Remove the generated directory after inspection if it is no
longer needed.

## Publishing readiness

Publishing is optional. If `planloft init` reports that GitHub is not ready, local
workflows still work. Authenticate `gh` or set `PLANLOFT_GITHUB_TOKEN` only before a
deliberate `publish` or `deploy` operation.

Published pages live in a public, enumerable GitHub repository even though their paths
are hard to guess and marked `noindex`. Keep sensitive documents local.
