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
  **GitHub Pages** — free, served at an unguessable URL, auto-expires after 30 days
  (`--ttl 90`, redeploy bumps expiry).

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
the backing GitHub Pages repository and manifest are public and enumerable. TTL values
must be positive integers, `rm` deletes stored source, and comments require valid
giscus configuration.

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

A theme directory may provide:

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
  "theme": "minimal",          // minimal | detailed | editorial | <custom>
  "planFormat": "md",          // md | html
  "defaultTtlDays": 30,
  "projects": {                // per-project overrides (theme, etc.)
    "github.com/you/subslot": { "theme": "editorial" }
  }
}
```

Theme resolution: **plan frontmatter > project override > global default**.

## Current scope

planloft currently supports direct document ingestion/rendering, the local doc store,
light-and-dark themed preview, copy-to-repo, one shared Claude Code/Codex plan skill,
and GitHub Pages deploys. Saved docs stay local until you copy or publish them. Deployed
review links are marked `noindex`, but their public repository remains enumerable, and
they expire through the GitHub Pages cleanup workflow.
