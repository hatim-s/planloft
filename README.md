# planloft

> Turn Markdown, JSON, HTML, and agent-written plans into consistently themed,
> shareable documents.

planloft is a document compiler, Claude Code / Codex **plugin, CLI, and Node library**.
Give it Markdown, a versioned JSON envelope, or trusted HTML; it can render a
self-contained HTML artifact, hoist the source into a per-project global store, or
publish it as a shareable review link that auto-expires.

## What it does

- **Auto-capture** — a bundled skill tells the agent to persist substantial plans; hooks
  backstop Claude plan-mode exit and Codex plan-mode turn stop. Plans and durable docs
  land in `~/.planloft/docs/<project>/`.
- **Organized by project** — keyed by git remote (fallback: path hash), so plans
  follow the repo, not the folder.
- **Themed** — every plan has a look *and* feel. `minimal`, `detailed`, `editorial`
  built in; drop your own in `~/.planloft/themes/`.
- **Caller-friendly input** — render, hoist, or publish Markdown and JSON directly;
  trusted HTML is available through an explicit safety option.
- **1-click copy** — `/planloft-copy` drops the plan into `./.planloft/plans/` in your
  repo, committed alongside code.
- **1-click deploy** — `/planloft-deploy` builds a themed static site and publishes it to
  **GitHub Pages** — free, served at an unguessable URL, auto-expires after 30 days
  (`--ttl 90`, redeploy bumps expiry).

## Install

```bash
# as a Claude Code plugin (recommended — auto-wires skill, hook, commands)
/plugin install planloft

# or the CLI standalone
pnpm add -g planloft
```

Codex support is shipped through `.codex-plugin/plugin.json`, the bundled `skills/`
directory, and `hooks/hooks.json`. Codex uses skills for the same flows: `write-plan`,
`save-doc`, `planloft-preview`, `planloft-copy`, and `planloft-deploy`.

Zero-config: it works on install. Config is written on your first plan; the GitHub
connect flow (`gh`) prompts on your first deploy.

## CLI

```
planloft render <input>       # Markdown/JSON -> HTML on stdout
planloft hoist <input>        # normalize + save in the project store
planloft publish <input>      # hoist + render + deploy in one operation
planloft list                 # docs grouped by project
planloft preview <slug>       # themed preview in your browser
planloft copy [slug]          # copy raw doc into ./.planloft/plans/
planloft deploy [slug]        # build + publish; prints the link
planloft rm <slug>            # remove a doc from the store
planloft config               # open/edit global config
planloft init                 # optional: set theme/format, verify GitHub
```

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
`--trusted-html` only for content you control.

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
omit it use Planloft's compatible default layout.

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
themed preview, copy-to-repo, Claude Code and Codex plugin wiring, and GitHub Pages
deploys. Saved docs stay local until you copy or publish them. Deployed review links are
public-by-link, marked `noindex`, and expire through the GitHub Pages cleanup workflow.
