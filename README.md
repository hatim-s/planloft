# planloft

> Turn Markdown, JSON, HTML, and agent-written plans into light-and-dark themed,
> shareable documents.

planloft is a document compiler, Claude Code / Codex **plugin, CLI, and Node library**.
Give it Markdown, a versioned JSON envelope, or trusted HTML; it can render a
self-contained HTML artifact, hoist the source into a per-project global store, or
publish it as a shareable review link that auto-expires.

## What it does

- **Focused plan capture** — the single `write-plan` skill tells the agent to persist
  substantial plans; hooks backstop Claude plan-mode exit and Codex plan-mode turn
  stop. Other documents remain available through `planloft hoist`.
- **Organized by project** — keyed by git remote (fallback: path hash), so plans
  follow the repo, not the folder.
- **Themed in light and dark** — every artifact starts with the browser's preferred
  color scheme and includes a theme toggle at the top. `minimal`, `detailed`, and
  `editorial` are built in; drop your own in `~/.planloft/themes/`.
- **Caller-friendly input** — render, hoist, or publish Markdown and JSON directly;
  trusted HTML is available through an explicit safety option.
- **CLI copy** — `planloft copy` drops a stored source into
  `<git-root>/.planloft/plans/`, ready to commit alongside code.
- **Explicit deploy** — `planloft deploy` builds a themed static site and publishes it to
  **GitHub Pages** — free, served at a hard-to-guess path marked `noindex`, and
  auto-expires after 30 days (`--ttl 90`; redeploy preserves the URL and moves the
  expiry forward). The backing repository is public and enumerable.

## Install

Planloft has three separate installation products. Pick the capability boundary you
want; installing one does not silently install either of the others.

| Product | Includes | Does not include |
|---|---|---|
| CLI-only | Executable, Node library, themes, schemas, renderer, local store, and publication runtime | Agent discovery or plan-mode hooks |
| Skill-only | One discoverable `write-plan` instruction directory | CLI, hooks, themes, schemas, runtime code, or plugin metadata |
| Full plugin | Plugin-root CLI bridge/runtime, one skill, plan-mode hook backstop, themes, schemas, and Codex/Claude plugin metadata | A global `planloft` command or automatic publication; deploy remains explicit |

### CLI-only

Install the runtime globally with exactly one package manager:

```bash
npm install -g planloft
pnpm add -g planloft
bun add -g planloft
```

Pin the runtime as `planloft@0.1.0`. An npm version pin applies to the CLI and
full-plugin artifact only; it does not pin a skill fetched from GitHub.

The version-pinned full-plugin and tagged-skill recipes require both npm
`planloft@0.1.0` and repository tag `v0.1.0` to exist. Until both release gates are
complete, they document the shipped contract but will not resolve from the public
registries. Development skill installs from `hatim-s/planloft` continue to follow the
default branch.

### CLI plus `write-plan`

The skill requires `planloft` on `PATH`. Install the CLI above, then use the matching
runner. These are the exact project/global and Codex/Claude recipes:

| Package manager | Agent | Project scope | Global scope |
|---|---|---|---|
| npm | Codex | `npx skills add hatim-s/planloft --skill write-plan -a codex` | `npx skills add hatim-s/planloft --skill write-plan -g -a codex` |
| npm | Claude Code | `npx skills add hatim-s/planloft --skill write-plan -a claude-code` | `npx skills add hatim-s/planloft --skill write-plan -g -a claude-code` |
| pnpm | Codex | `pnpm dlx skills add hatim-s/planloft --skill write-plan -a codex` | `pnpm dlx skills add hatim-s/planloft --skill write-plan -g -a codex` |
| pnpm | Claude Code | `pnpm dlx skills add hatim-s/planloft --skill write-plan -a claude-code` | `pnpm dlx skills add hatim-s/planloft --skill write-plan -g -a claude-code` |
| Bun | Codex | `bunx skills add hatim-s/planloft --skill write-plan -a codex` | `bunx skills add hatim-s/planloft --skill write-plan -g -a codex` |
| Bun | Claude Code | `bunx skills add hatim-s/planloft --skill write-plan -a claude-code` | `bunx skills add hatim-s/planloft --skill write-plan -g -a claude-code` |

Each recipe targets exactly one agent. With one target, `skills@1.5.22` installs a
direct copy at that agent's discovery path; `--copy` makes the same choice explicit.
Legacy multi-agent installs may use a canonical skill plus agent links. Reserve `-y`
for CI and other deliberately noninteractive runs. Start a new Codex or Claude session
after installation so the target reloads discovery.

The runner is `npx`, `pnpm dlx`, or `bunx`; the executable is the separate `skills`
package. There is no generic `npm skills`, `pnpm skills`, or `bun skills` command.

`hatim-s/planloft` follows the repository's current default branch and is appropriate
for latest development. Reproducible released skill installation uses the release tag
in the GitHub tree URL, independently of the npm package version:

```bash
npx skills add https://github.com/hatim-s/planloft/tree/v0.1.0/skills/write-plan \
  --skill write-plan -g -a codex
```

Use the same URL with `pnpm dlx skills` or `bunx skills`, and select
`-a claude-code` or omit `-g` as needed. A release is not installation-ready until the
tag exists and its repository contains exactly the intended `write-plan` skill.

### Full plugin

The repository exposes Codex and Claude marketplace catalogs whose Planloft entry pins
the exact npm package version. The package must already be published before these
recipes can succeed.

Codex personal installation:

```bash
codex plugin marketplace add hatim-s/planloft --ref v0.1.0
codex plugin add planloft@planloft
```

For a repository-curated Codex install, place the shipped
`.agents/plugins/marketplace.json` in that repository, then register that repository
before installing from its catalog:

```bash
REPO_ROOT="$(git rev-parse --show-toplevel)"
codex plugin marketplace add "$REPO_ROOT"
codex plugin add planloft@planloft
```

Start a new session and review/trust the bundled hook before enabling it.

Claude Code supports explicit user, project, and local scope:

```bash
claude plugin marketplace add https://github.com/hatim-s/planloft.git#v0.1.0 --scope user
claude plugin install planloft@planloft --scope user

# Replace both occurrences of "user" with "project" or "local" for that scope.
```

Skill-only installation never installs or enables hooks. Full-plugin installation adds
the hook definition and a plugin-root `bin/planloft` bridge used by both the hook and
the bundled skill. It does not add `planloft` globally to `PATH`; install the CLI-only
product separately for shells outside the plugin. The host may still require reload,
enablement, and trust review.
Both Codex and Claude require a new session or plugin reload before newly installed
components are discoverable. See [the migration guide](https://github.com/hatim-s/planloft/blob/main/docs/installation-migration.md)
before upgrading an installation that still exposes the retired skills.

Codex and Claude Code consume the same `write-plan` instructions. Preview, copy, and
deploy are CLI commands rather than separately triggered skills. Configuration is
created on first use; publishing remains an explicit action.

## CLI

<!-- planloft:command-knowledge:start -->
- `planloft render <input>` — Render Markdown, JSON, or trusted HTML to a self-contained HTML artifact.
- `planloft hoist <input>` — Normalize Markdown, JSON, or trusted HTML into the current project's store.
- `planloft publish <input>` — Hoist, render, and publish a source to GitHub Pages.
- `planloft list` — List stored documents grouped by project.
- `planloft preview [slug]` — Build and open a local themed preview of a stored document.
- `planloft copy [slug]` — Copy a stored document's raw source into the current repository.
- `planloft deploy [slug]` — Build and publish a stored document to GitHub Pages.
- `planloft rm <slug>` — Delete a stored document's source and index entry.
- `planloft resolve` — Resolve the exact plan path, kind, theme, and authoring template.
- `planloft config` — Open the versioned global configuration in $EDITOR, validate it, or print it.
- `planloft init` — Create default configuration and report GitHub readiness.
<!-- planloft:command-knowledge:end -->

Run `planloft help` for workflow groups and safety markers, or `planloft help
<command>` for defaults and tested examples.

`<input>` may be a `.md`, `.json`, or `.html` file. Use `- --format md|json|html` for
stdin. Direct rendering writes HTML to stdout unless `--out <file-or-directory>` is
provided.

```text
<!-- planloft:command-examples:start -->
planloft render proposal.md --theme editorial --out ./proposal-site
planloft hoist proposal.json
planloft publish proposal.md --ttl 30
<!-- planloft:command-examples:end -->
```

This block is generated from the same command knowledge used by `planloft help
<command>` and is checked for exact drift in the test suite.

HTML input and embedded Markdown HTML are disabled for direct callers by default. Use
`--trusted-html` only for content you control. `publish` and `deploy` write to GitHub;
the page path is hard to guess and marked `noindex`, but the backing GitHub Pages
repository is public. Repository visitors can enumerate document folders and manifest
metadata. Keep sensitive plans local. TTL values from `--ttl` and
`config.defaultTtlDays` must be finite positive integers; the configured default is
used only when `--ttl` is omitted. `rm` deletes stored source.

`planloft copy` finds the Git root even when invoked from a nested directory or linked
worktree. Outside Git it uses the current directory and prints a fallback notice. It
preserves the stored source byte-for-byte and refuses to replace an existing copy unless
`--force` is provided.

### GitHub authentication

Before any repository mutation, Planloft validates the selected credential with
GitHub. Credential discovery has this exact precedence:

1. An installed and authenticated `gh` CLI.
2. `PLANLOFT_GITHUB_TOKEN`.
3. `github.token` in Planloft configuration.
4. A hidden prompt, only when both stdin and stdout are interactive terminals.

Noninteractive runs never prompt and fail with stable `PLANLOFT_GITHUB_AUTH_*` error
codes when credentials are missing, invalid, or cannot be validated. Planloft never
prints tokens, prompted tokens are not saved, and Git remotes always retain clean
`https://github.com/<owner>/<repo>.git` URLs rather than token-bearing URLs.

### Giscus comments

Comments are off by default. Before using `--comments`, enable GitHub Discussions on
the selected public repository, install/enable the giscus GitHub App for that
repository, and create or select a Discussions category supported by giscus. Use
[giscus.app](https://giscus.app) to obtain the repository and category IDs, then set
all four required fields:

```jsonc
{
  "giscus": {
    "repo": "owner/planloft-plans",
    "repoId": "R_kg...",
    "category": "Plan reviews",
    "categoryId": "DIC_kw..."
  },
  "projects": {
    "github.com/you/project": {
      "giscus": { "category": "Project plan reviews", "categoryId": "DIC_kw..." }
    }
  }
}
```

Project giscus fields override global fields individually. Planloft validates the
effective `repo`, `repoId`, `category`, and `categoryId` before rendering or Git
operations and emits the giscus client only for `--comments` deployments.

## JSON document format

JSON is a small metadata envelope around Markdown or trusted HTML, not a proprietary
tree of content blocks:

```json
{
  "version": 1,
  "title": "Launch plan",
  "slug": "launch-plan",
  "kind": "plan",
  "theme": "detailed",
  "status": "active",
  "contentFormat": "md",
  "content": "# Goal\n\nShip the release.\n\n## Steps\n\n- Verify CI.\n- Publish."
}
```

Only `content` is required. Present `title`, `slug`, `kind`, `theme`, and `status`
values must be nonblank strings; Planloft trims surrounding whitespace. When `title` is
omitted from a Markdown source, Planloft uses the first parsed level-one Markdown
heading, then the slug or source filename. Unknown fields and unsupported versions are
rejected. The version-1 machine-readable contract is shipped at
`schemas/document.v1.schema.json` with schema identity
`https://github.com/hatim-s/planloft/schemas/document.v1.schema.json`.

## Node library

Use the asynchronous application interface when a Node caller needs the same complete
operation as the CLI, with structured results and stable error categories:

<!-- planloft:node-application-example:start -->
```js
import { createPlanloftApplication } from "planloft";

const planloft = createPlanloftApplication({ cwd: process.cwd() });
const result = await planloft.resolve({
  kind: "plan",
  slug: "launch-plan",
  title: "Launch plan",
});
console.log(result.context.path);
```
<!-- planloft:node-application-example:end -->

Use the focused compiler exports when only ingestion or rendering is needed:

```ts
import { ingestDocument, renderDocument } from "planloft";

const doc = ingestDocument(JSON.stringify({
  title: "Launch plan",
  content: "# Goal\n\nShip the release.",
}), { format: "json" });

const html = renderDocument(doc, "minimal");
```

`hoistDocument(doc)` persists the same canonical document in the current project's
global Planloft store. These three focused compatibility exports remain public:
`ingestDocument`, `hoistDocument`, and `renderDocument`. Internal historical
`src/commands/*` handlers are not a public interface and have no compatibility shims.

## Custom themes

A theme name must resolve to a built-in or user theme directory. Unknown-theme errors list
the available themes. Within a real theme directory, all three assets are optional:

```text
~/.planloft/themes/<name>/
  template.md   # authoring guidance for agents
  style.css     # visual skin
  layout.html   # optional constrained document layout
```

`layout.html` supports only `{{title}}`, `{{kind}}`, `{{body}}`, `{{styles}}`,
`{{robots}}`, and `{{comments}}`. It does not execute expressions or code. Themes that
omit it use Planloft's compatible default layout. Custom CSS should include the marker
`/* planloft-color-schemes: light dark */`, define a system dark palette with
`prefers-color-scheme`, and support the `data-planloft-color-scheme="light|dark"`
override. Without the marker, Planloft supplies a readable system-color fallback.

## Config (`~/.planloft/config.json`)

```jsonc
{
  "version": 1,
  "theme": "minimal",          // minimal | detailed | editorial | <custom>
  "defaultTtlDays": 30,
  "github": {
    "repo": "planloft-plans"   // optional; token may come from auth precedence above
  },
  "giscus": {                  // optional; required only with --comments
    "repo": "owner/planloft-plans",
    "repoId": "R_kg...",
    "category": "Plan reviews",
    "categoryId": "DIC_kw..."
  },
  "projects": {                // per-project overrides (theme, etc.)
    "github.com/you/subslot": {
      "theme": "editorial",
      "giscus": { "category": "Project reviews", "categoryId": "DIC_kw..." }
    }
  }
}
```

Theme resolution: **plan frontmatter > project override > global default**.
Giscus resolution: **project field > global field**.

The version-1 configuration contract is published at `schemas/config.schema.json`.
Defaults are used only when `config.json` is absent. Malformed JSON, inaccessible files,
unsupported versions, unknown properties, and invalid values fail with stable diagnostics;
`planloft config` validates the file after the editor closes.

Agent write-direct capture is Markdown-only. Remove the retired `planFormat` property
from existing configuration; `planFormat: "html"` produces a dedicated migration
diagnostic. Explicit trusted HTML input and already indexed HTML documents remain
renderable and deployable.

## Current scope

planloft currently supports direct document ingestion/rendering, the local doc store,
light-and-dark themed preview, copy-to-repo, one shared Claude Code/Codex plan skill,
and GitHub Pages deploys. Saved docs stay local until you copy or publish them. Deployed
review links use hard-to-guess paths marked `noindex`, but their public repository,
document folders, and manifest metadata remain enumerable. Sensitive documents should
remain local. Deploys expire through the GitHub Pages cleanup workflow.
