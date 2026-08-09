# Migrate an existing Planloft installation

Planloft now ships one agent skill, `write-plan`. Follow these steps once for every
machine or project that used an older Planloft installation.

## 1. Remove the retired skills

The retired skill names are `save-doc`, `planloft-preview`, `planloft-copy`, and
`planloft-deploy`.

For project-scoped installs:

```bash
npx skills remove save-doc planloft-preview planloft-copy planloft-deploy -a codex -y
npx skills remove save-doc planloft-preview planloft-copy planloft-deploy -a claude-code -y
```

For global installs, add `-g`:

```bash
npx skills remove save-doc planloft-preview planloft-copy planloft-deploy -g -a codex -y
npx skills remove save-doc planloft-preview planloft-copy planloft-deploy -g -a claude-code -y
```

What this does: removes installer-managed symlinks and `--copy` installs. If you used
pnpm or Bun originally, substitute `pnpm dlx skills` or `bunx skills` for `npx skills`.

If the installer cannot find an old copy, remove only the retired-name directories:

| Scope | Codex/universal paths | Claude Code path |
|---|---|---|
| Project | `.agents/skills/<retired-name>` or `.codex/skills/<retired-name>` | `.claude/skills/<retired-name>` |
| Global | `~/.agents/skills/<retired-name>` or `~/.codex/skills/<retired-name>` | `~/.claude/skills/<retired-name>` |

Do not delete the parent skills directory or `write-plan`.

## 2. Upgrade the CLI

Choose the package manager you use:

```bash
npm install -g planloft@0.1.0
# or: pnpm add -g planloft@0.1.0
# or: bun add -g planloft@0.1.0

planloft --version
```

Expected: `planloft --version` prints `0.1.0`.

## 3. Install the one remaining skill

Choose your agent and scope. These examples use npm/npx:

```bash
# Codex, current project
npx skills add hatim-s/planloft --skill write-plan -a codex

# Claude Code, current project
npx skills add hatim-s/planloft --skill write-plan -a claude-code

# Add -g for a global installation.
```

What this does: installs the `write-plan` instructions only. A skill-only installation
does not install the CLI, hooks, themes, schemas, or other plugin assets.

Restart the agent and confirm that `write-plan` is discoverable.

## 4. Upgrade or remove a full plugin

Skip this step if you only installed the CLI and skill.

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

Expected: the host lists one Planloft plugin and one `write-plan` skill after restart.

## 5. Replace removed commands

Remove the old Claude aliases `/planloft-preview`, `/planloft-copy`, and
`/planloft-deploy`. Use the CLI directly:

| Old behavior | Replacement |
|---|---|
| Save an agent-authored plan | `write-plan` |
| Store another existing file | `planloft hoist <input>` |
| Preview | `planloft preview [slug]` |
| Copy | `planloft copy [slug]` |
| Deploy | `planloft deploy [slug]` |

The retired skills and aliases were removed without wrappers. Update scripts and agent
instructions to use these commands instead of recreating compatibility shims.

## 6. Update the configuration

Open `~/.planloft/config.json` and remove `planFormat`. New agent-authored plans are
Markdown-only; `planFormat: "html"` is rejected. Explicitly trusted HTML and already
indexed legacy HTML can still be rendered or deployed.

Then validate the strict version-1 configuration:

```bash
EDITOR="${EDITOR:-nano}" planloft config
```

Fix any reported unknown fields, invalid theme paths, or invalid values. Defaults are
used only when the configuration file is absent.

TTL values in `--ttl` and `defaultTtlDays` must be finite positive integers. Zero is no
longer a permanent-deployment value.

## 7. Review publication settings

Planloft deployments use a public GitHub repository. `noindex` discourages search
indexing, but it does not make a plan private. Keep sensitive plans local.

Comments are off by default. To use them, enable GitHub Discussions and giscus for the
public repository, then configure all four values:

- `giscus.repo`
- `giscus.repoId`
- `giscus.category`
- `giscus.categoryId`

## 8. Update Node callers, if any

Applications that need the complete CLI-equivalent interface should use the async
`createPlanloftApplication()` API and handle `PlanloftApplicationError` codes.

The focused package-root exports `ingestDocument`, `hoistDocument`, and
`renderDocument` remain available. Direct imports from the old `src/commands/*`
implementation must be replaced rather than adding backward-compatibility shims.

## 9. Verify the migration

```bash
planloft --version
planloft init
planloft list
```

Expected: the version is `0.1.0`, configuration validation succeeds, and existing
documents are listed. Finally, create a small test plan with `write-plan` and preview it
with `planloft preview [slug]`.
