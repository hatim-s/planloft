# planloft

> Turn Markdown, JSON, HTML, and agent-written plans into light-and-dark themed,
> shareable documents.

Planloft is a CLI for writing, storing, previewing, and explicitly publishing documents.
It includes optional agent skills for saving substantial plans and customizing Planloft.

## What it does

- Stores documents by project, keyed by the Git remote when available.
- Renders self-contained HTML with built-in light and dark themes.
- Previews locally and copies source back into a repository.
- Publishes expiring review links to GitHub Pages only when explicitly requested.
- Accepts Markdown, a versioned JSON envelope, or explicitly trusted HTML.

## Install

### CLI-only

Install the CLI with one package manager, then initialize it:

```bash
npm install -g planloft
# or: pnpm add -g planloft
# or: bun add -g planloft

planloft init
```

`planloft init` creates the default configuration if needed, keeps an existing valid
configuration unchanged, and reports GitHub readiness. It does not publish anything.

### CLI plus `write-plan`

Install the CLI above, then install the skill for the agent that should write Planloft
plans:

```bash
# Codex
npx skills add hatim-s/planloft --skill write-plan -a codex

# Claude Code
npx skills add hatim-s/planloft --skill write-plan -a claude-code
```

Restart the agent after installation, then run `planloft init`. The skill requires the
CLI on `PATH`; it does not install the CLI or publish documents.

Planloft also ships `customize-planloft` for explaining the document pipeline and
building custom themes. Install it with the same command by changing the `--skill`
value.

For pnpm, Bun, project/global scope, CI, and agent-oriented verification, see
[Setup](./docs/setup.md). Full Codex or Claude plugin installation is not currently a
supported setup path.

## Quick start

```bash
planloft init
planloft hoist proposal.md
planloft preview
```

To render without storing:

```bash
planloft render proposal.md --theme editorial --out ./proposal-site
```

To publish only when you intend to create a public review link:

```bash
planloft publish proposal.md --ttl 30
```

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

Run `planloft help` for workflows, defaults, examples, and write-safety markers, or
`planloft help <command>` for one operation.

`<input>` may be a `.md`, `.json`, or `.html` file. Use `- --format md|json|html` for
stdin. HTML input and embedded Markdown HTML require `--trusted-html`; use it only for
content you control.

```text
<!-- planloft:command-examples:start -->
planloft render proposal.md --theme editorial --out ./proposal-site
planloft hoist proposal.json
planloft publish proposal.md --ttl 30
<!-- planloft:command-examples:end -->
```

## Publication safety

Published pages use hard-to-guess paths and `noindex`, but the backing GitHub Pages
repository is public and enumerable. Keep sensitive documents local. Publishing and
deploying are always explicit; stored documents remain local until copied or published.

## Documentation

- [Set up Planloft for humans, agents, and CI](./docs/setup.md)
- [Migrate an older installation](./docs/installation-migration.md)
- [Architecture decisions](./docs/adr/README.md)
- [Release guide](./docs/releasing.md)

Planloft requires Node.js 18 or newer and is licensed under the [MIT License](./LICENSE).
