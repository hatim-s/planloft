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
- **CLI copy** — `planloft copy` drops a stored source into `./.planloft/plans/` in your
  repo, ready to commit alongside code.
- **Explicit deploy** — `planloft deploy` builds a themed static site and publishes it to
  **GitHub Pages** — free, served at a hard-to-guess path marked `noindex`, and
  auto-expires after 30 days (`--ttl 90`; redeploy preserves the URL and moves the
  expiry forward). The backing repository is public and enumerable.

## Install

Planloft has three distinct installation surfaces:

| Install | Command | Includes |
|---|---|---|
| CLI only | `pnpm add -g planloft` | Every `planloft` command and the Node library; no agent skill or hooks |
| `write-plan` skill only | `npx skills add hatim-s/planloft --skill write-plan` | The semantic skill only; install the CLI separately so `planloft resolve` is available |
| Full plugin | `/plugin install planloft` | One `write-plan` skill, plan-mode capture hooks, plugin metadata, and the bundled CLI |

The skill installer also works as `pnpm dlx skills add hatim-s/planloft --skill
write-plan` or `bunx skills add hatim-s/planloft --skill write-plan`. The runner is
`npx`, `pnpm dlx`, or `bunx`; there is no generic `npm skills`, `pnpm skills`, or `bun
skills` command.

Codex and Claude Code consume the same `write-plan` skill. Preview, copy, and deploy
are CLI commands rather than separately triggered skills. Configuration is created on
first use; publishing remains an explicit action.

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
- `planloft config` — Open the global configuration in $EDITOR or print it.
- `planloft init` — Create default configuration and report GitHub readiness.
<!-- planloft:command-knowledge:end -->

Run `planloft help` for workflow groups and safety markers, or `planloft help
<command>` for defaults and tested examples.

`<input>` may be a `.md`, `.json`, or `.html` file. Use `- --format md|json|html` for
stdin. Direct rendering writes HTML to stdout unless `--out <file-or-directory>` is
provided.

```bash
planloft render proposal.md --theme editorial --out ./proposal-site
planloft hoist proposal.json
planloft publish proposal.json --ttl 30
printf '{"title":"Launch","content":"# Goal\\n\\nShip."}' |
  planloft render - --format json > index.html
```

HTML input and embedded Markdown HTML are disabled for direct callers by default. Use
`--trusted-html` only for content you control. `publish` and `deploy` write to GitHub;
the page path is hard to guess and marked `noindex`, but the backing GitHub Pages
repository is public. Repository visitors can enumerate document folders and manifest
metadata. Keep sensitive plans local. TTL values from `--ttl` and
`config.defaultTtlDays` must be finite positive integers; the configured default is
used only when `--ttl` is omitted. `rm` deletes stored source.

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

Only `content` is required. The machine-readable contract is shipped at
`schemas/document.schema.json`.

## Node library

```ts
import { ingestDocument, renderDocument } from "planloft";

const doc = ingestDocument(JSON.stringify({
  title: "Launch plan",
  content: "# Goal\n\nShip the release.",
}), { format: "json" });

const html = renderDocument(doc, "minimal");
```

`hoistDocument(doc)` persists the same canonical document in the current project's
global Planloft store.

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
  "planFormat": "md",          // md | html
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

## Current scope

planloft currently supports direct document ingestion/rendering, the local doc store,
light-and-dark themed preview, copy-to-repo, one shared Claude Code/Codex plan skill,
and GitHub Pages deploys. Saved docs stay local until you copy or publish them. Deployed
review links use hard-to-guess paths marked `noindex`, but their public repository,
document folders, and manifest metadata remain enumerable. Sensitive documents should
remain local. Deploys expire through the GitHub Pages cleanup workflow.
