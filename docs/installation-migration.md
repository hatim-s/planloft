# Migrate an existing Planloft installation

Planloft 0.2.2 replaces the short portable skill names with
`planloft-write-doc` and `planloft-customise`. Codex keeps the product labels
`planloft:write-doc` and `planloft:customise`; Claude Code and other Agent Skills hosts
use the new hyphenated names. Follow these steps once for every machine or project that
used an older Planloft installation.

## 1. Remove the retired skills

The retired skill names are `write-doc`, `customize`, `customise`, `write-plan`,
`customize-planloft`, `save-doc`, `planloft-preview`, `planloft-copy`, and
`planloft-deploy`.

For project-scoped installs:

```bash
npx skills remove write-doc customize customise write-plan customize-planloft save-doc planloft-preview planloft-copy planloft-deploy -a codex -y
npx skills remove write-doc customize customise write-plan customize-planloft save-doc planloft-preview planloft-copy planloft-deploy -a claude-code -y
npx skills remove write-doc customize customise write-plan customize-planloft save-doc planloft-preview planloft-copy planloft-deploy -a pi -y
```

For global installs, add `-g`:

```bash
npx skills remove write-doc customize customise write-plan customize-planloft save-doc planloft-preview planloft-copy planloft-deploy -g -a codex -y
npx skills remove write-doc customize customise write-plan customize-planloft save-doc planloft-preview planloft-copy planloft-deploy -g -a claude-code -y
npx skills remove write-doc customize customise write-plan customize-planloft save-doc planloft-preview planloft-copy planloft-deploy -g -a pi -y
```

What this does: removes installer-managed symlinks and `--copy` installs. If you used
pnpm or Bun originally, substitute `pnpm dlx skills` or `bunx skills` for `npx skills`.

If the installer cannot find an old copy, remove only the retired-name directories:

| Scope | Codex/universal paths | Claude Code path | Pi path |
|---|---|---|---|
| Project | `.agents/skills/<retired-name>` or `.codex/skills/<retired-name>` | `.claude/skills/<retired-name>` | `.pi/skills/<retired-name>` |
| Global | `~/.agents/skills/<retired-name>` or `~/.codex/skills/<retired-name>` | `~/.claude/skills/<retired-name>` | `~/.pi/agent/skills/<retired-name>` |

Do not delete the parent skills directory or the new `planloft-write-doc` and
`planloft-customise` skills.

## 2. Remove a retired host installation

Older Planloft releases could be installed as a Codex or Claude host bundle. Planloft
0.2.2 does not ship that product. If you used it, remove it before restarting the
host so the retired skills and automatic lifecycle behavior do not remain active:

```bash
# Codex
codex plugin remove planloft

# Claude Code
claude plugin uninstall planloft@planloft
```

Expected: the host no longer lists a Planloft plugin. There is no replacement host
bundle in 0.2.2; install the CLI and focused portable skills in the next steps.

## 3. Upgrade the CLI

Choose the package manager you use:

```bash
npm install -g planloft@0.2.2
# or: pnpm add -g planloft@0.2.2
# or: bun add -g planloft@0.2.2

planloft --version
```

Expected: `planloft --version` prints `0.2.2`.

## 4. Install the focused skills

Choose your agent and scope. These examples use npm/npx:

```bash
# Codex, current project
npx skills add hatim-s/planloft --skill planloft-write-doc -a codex

# Claude Code, current project
npx skills add hatim-s/planloft --skill planloft-write-doc -a claude-code

# Pi, current project
npx skills add hatim-s/planloft --skill planloft-write-doc -a pi

# Add -g for a global installation.
```

What this does: installs the `planloft-write-doc` instructions only. A skill-only installation
does not install the CLI, themes, schemas, or other runtime assets.

Install `planloft-customise` independently when the agent should explain Planloft or work on
themes by replacing `planloft-write-doc` in the matching command. Restart the agent and
confirm that the selected skills are discoverable.

## 5. Replace removed commands

Remove the old Claude aliases `/planloft-preview`, `/planloft-copy`, and
`/planloft-deploy`. Use the CLI directly:

| Old behavior | Replacement |
|---|---|
| Save an agent-authored document | `planloft-write-doc` |
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

Expected: the version is `0.2.2`, configuration validation succeeds, and existing
documents are listed. Finally, create a small test plan with `planloft-write-doc` and preview it
with `planloft preview [slug]`.
