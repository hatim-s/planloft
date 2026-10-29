# Migrate an existing Planloft installation

Planloft 0.2.3 replaces the short portable skill names with
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
0.2.3 does not ship that product. If you used it, remove it before restarting the
host so the retired skills and automatic lifecycle behavior do not remain active:

```bash
# Codex
codex plugin remove planloft

# Claude Code
claude plugin uninstall planloft@planloft
```

Expected: the host no longer lists a Planloft plugin. There is no replacement host
bundle in 0.2.3; install the CLI and focused portable skills in the next steps.

## 3. Upgrade the CLI

Choose the package manager you use:

```bash
npm install -g planloft@0.2.3
# or: pnpm add -g planloft@0.2.3
# or: bun add -g planloft@0.2.3

planloft --version
```

Expected: `planloft --version` prints `0.2.3`.

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

Open `~/.planloft/config.json` and remove `planFormat`. Authors choose Markdown, MDX, or HTML according to the document; themes control colors and typography; `planFormat: "html"` is rejected. MDX requires explicit trust and a compiled snapshot. Explicitly trusted HTML and already
indexed legacy HTML can still be rendered or deployed. Frameset HTML is not supported;
convert it to an ordinary body or keep the original externally.

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

Expected: the version is `0.2.3`, configuration validation succeeds, and existing
documents are listed. Finally, create a small test plan with `planloft-write-doc` and preview it
with `planloft preview [slug]`.

## Document migration

`planloft migrate <source> --out <destination> --dry-run` checks a one-way Markdown
conversion to MDX without writing. Remove `--dry-run` to create the destination and a
`.bak` copy of the original alongside it. Existing destinations and backups must match
the expected bytes; they are never replaced. If the destination matches but the
backup is absent, a dry run reports `dry-run-backup` and a write creates the backup
and reports `backup-created`. Repeated runs with matching destination and backup
are unchanged. The converter preserves frontmatter, code and common GFM syntax, including
tables, links, strikethrough and task lists. It checks MDX syntax without executing it.
Raw HTML, including scripts and comments, requires review at the reported location.
Keep layout and scripts in HTML when their behavior matters, or replace static markup
with equivalent Markdown or a reviewed component before migration. Existing `.html`
and `.htm` files can instead be copied to the same extension without conversion.

GFM task lists are static. Collaboration is opt-in and shared task state requires
explicit stable task keys; migration does not infer them from text. Migrated MDX and
its dependencies still require explicit trust before rendering or hoisting.

## Legacy theme migration

Theme migration is one-way and agent-guided; `planloft migrate` does not migrate
themes. Back up the original theme and affected sources before editing. Preserve
authored Markdown and MDX content, comments, scripts, and stable task keys. Inspect the
old template, layout, and styles against representative documents.

Create a separate theme directory with a new, unused candidate name and a token-only
`style.css`. Convert palette and font values to the public variables in the
[theme contract](../skills/planloft-customise/references/themes.md). The runtime
rejects legacy template and layout files, so the candidate must not contain them.
Arbitrary structural CSS does not automatically translate to tokens. Move old layout
and structural styling into copies of individual HTML or MDX sources only where needed.

Review the candidate and document copies, then render representative copies with
`planloft render <source> --theme <candidate-name> --out <temporary-directory>`, using
the appropriate trust flags. Check light and dark modes. Keep the originals unchanged
until review and rendering succeed. Then promote the reviewed candidate CSS to the
original theme name, remove its legacy `template.md`, `template.mdx`, and `layout.html`,
and apply the reviewed document changes. Keep the backups and candidate until the
replacement has been checked. If validation fails, revise the candidate and repeat.
The `planloft-migrate` skill can guide this work.

### Legacy rendered HTML

Old compiled HTML may contain unmarked Planloft controls and theme styles. The current
renderer rejects conflicting controls instead of stripping unknown authored content.
Regenerate from the original Markdown or MDX when available. If only the old HTML
artifact remains, back it up and work on a candidate copy. Identify and remove only
controls, scripts, and theme styles verified to be generated by the old renderer;
preserve author code. Never blindly delete content using a marker regex. Render the
candidate and compare it with the original before replacing anything.
