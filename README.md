# planloft

> Turn Markdown, MDX, JSON, HTML, and agent-written plans into light-and-dark themed,
> shareable documents.

Planloft is a CLI for writing, storing, previewing, and explicitly publishing documents.
It includes optional agent skills for saving substantial plans and customizing Planloft.

## What it does

- Stores documents by project, keyed by the Git remote when available.
- Renders self-contained HTML with built-in light and dark themes.
- Previews locally and copies source back into a repository.
- Publishes expiring review links to GitHub Pages or Vercel only when explicitly requested.
- Accepts Markdown, explicitly trusted MDX, a versioned JSON envelope, or explicitly trusted HTML.

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
Use `planloft init --force` only to replace `config.json` with exact defaults. The reset
discards configured settings and credentials but preserves stored documents, custom
themes, hosting clones, and project files.

### CLI plus `planloft-write-doc`

Install the CLI above, then install the skill for the agent that should write Planloft
plans:

```bash
# Codex
npx skills add hatim-s/planloft --skill planloft-write-doc -a codex

# Claude Code
npx skills add hatim-s/planloft --skill planloft-write-doc -a claude-code

# Pi
npx skills add hatim-s/planloft --skill planloft-write-doc -a pi
```

Restart the agent after installation, then run `planloft init`. The skill requires the
CLI on `PATH`; it does not install the CLI or publish documents.

Planloft also ships `planloft-customise` for explaining the document pipeline and
building custom themes. Codex UI metadata labels the two skills `planloft:write-doc`
and `planloft:customise`; Claude Code and other hosts use the portable
`planloft-write-doc` and `planloft-customise` names shown by the installer.

For pnpm, Bun, project/global scope, CI, and agent-oriented verification, see
[Setup](./docs/setup.md).

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

## Built-in themes

Planloft includes six color and typography themes: `minimal`, `detailed`, `editorial`,
`decision`, `research`, and `briefing`. Select one with `--theme <name>`, document
metadata, a project override, or the global configuration. Themes do not prescribe a
document's structure. See the [theme catalog](./themes/README.md).

## Local gallery

Generate a local gallery of the six themes and the static component catalog:

```sh
planloft gallery --out ./planloft-gallery
```

Open the generated `index.html` to browse it. To use the gallery's appearance controls
across its preview frames, serve the directory locally:

```sh
python3 -m http.server 4321 --bind 127.0.0.1 --directory ./planloft-gallery
```

Open `http://127.0.0.1:4321/`. Choose an output directory you own; the command writes
the gallery files there and does not publish them.

## CLI

<!-- planloft:command-knowledge:start -->
- `planloft render <input>` — Render Markdown, trusted MDX, JSON, or trusted HTML to a self-contained HTML artifact.
- `planloft hoist <input>` — Normalize Markdown, trusted MDX, JSON, or trusted HTML into the current project's store.
- `planloft publish <input>` — Hoist, render, and publish a source to GitHub Pages or Vercel.
- `planloft list` — List stored documents grouped by project.
- `planloft preview [slug]` — Build and open a local themed preview of a stored document.
- `planloft copy [slug]` — Copy a stored document's raw source into the current repository.
- `planloft deploy [slug]` — Build and publish a stored document to GitHub Pages or Vercel.
- `planloft gallery` — Build a local gallery of bundled themes and components.
- `planloft attach <input>` — Attach a collaboration client to existing HTML.
- `planloft collaboration-build` — Generate local collaboration service deployment files.
- `planloft migrate <source>` — Convert eligible Markdown to MDX or copy HTML unchanged with a backup.
- `planloft migrate-to-vercel <directory>` — Migrate a legacy hosting repository to the Vercel layout while retaining GitHub Pages support.
- `planloft rm <slug>` — Delete a stored document's source and index entry.
- `planloft resolve` — Resolve the store path, source format, and selected theme CSS.
- `planloft config` — Open the versioned global configuration in $EDITOR, validate it, or print it.
- `planloft init` — Create or explicitly reset default configuration and report GitHub readiness.
<!-- planloft:command-knowledge:end -->

Run `planloft help` for workflows, defaults, examples, and write-safety markers, or
`planloft help <command>` for one operation.

`<input>` may be a `.md`, `.mdx`, `.json`, or `.html` file. Use `- --format md|mdx|json|html` for
stdin. HTML input and embedded Markdown HTML require `--trusted-html`; use it only for
content you control. Authored HTML retains its structure, styles, and scripts while
Planloft supplies the selected theme CSS and controls. HTML can opt into semantic
styling with `.planloft-prose` and reading/full-width support with
`.planloft-plan > article`. See the [theme contract](./skills/planloft-customise/references/themes.md)
for public CSS variables and an example.

```text
<!-- planloft:command-examples:start -->
planloft render proposal.md --theme editorial --out ./proposal-site
planloft hoist proposal.json
planloft publish proposal.md --ttl 30
<!-- planloft:command-examples:end -->
```

## Publication safety

Published pages use hard-to-guess paths. Planloft adds `noindex` to rendered Markdown,
MDX, and HTML. The backing GitHub Pages
repository is public and enumerable. Keep sensitive documents local. Publishing and
deploying are always explicit; stored documents remain local until copied or published.

## Documentation

- [Set up Planloft for humans, agents, and CI](./docs/setup.md)
- [Migrate an older installation](./docs/installation-migration.md)
- [MDX components and shared task keys](./docs/components.md)
- [Architecture decisions](./docs/adr/README.md)
- [Release guide](./docs/releasing.md)

Planloft requires Node.js 18 or newer and is licensed under the [MIT License](./LICENSE).

For Vercel setup, shared hosting, and the one-way repository migration, see [Deployment](./docs/deployment.md).

### Trusted MDX

Use `.mdx` for documents with JSX and components. MDX imports and expressions run as server-side code, so render, hoist, and publish require `--trusted-mdx`. Only use it for source and dependency snapshots you trust. Markdown and HTML keep their existing trust rules.

```sh
planloft render report.mdx --trusted-mdx --out ./report-site
planloft hoist report.mdx --trusted-mdx
```

Built-in component tags work without imports; they can also be imported from `planloft/components`. Local `.tsx` and `.mdx` imports resolve relative to the document. Charts and tables render static HTML and SVG. Exports from `~/.planloft/components/index.tsx` and the project's `.planloft/components/index.tsx` are available as MDX components. Project entries take precedence over global entries and built-ins. Registry files are executable code too.

Hoist bundles the document and its dependencies beside the stored source as `<document>.mdx.bundle.js`. Copy carries that snapshot along. Preview and publication use the snapshot even if the original dependency files move. If the stored source changes, Planloft rejects the stale snapshot; hoist the edited document again from a location with its dependencies. Treat the snapshot as trusted executable code, not as a sandbox or a tamper-proof signature.

### Collaboration

Collaboration is opt-in. Attach it to an existing HTML document with `planloft attach`
and generate a service with `planloft collaboration-build`. The generated Cloudflare
service uses D1; the Vercel service uses Turso. Configure their database bindings and
admin credentials server-side and apply the generated SQL migration before use.
Generation is local and does not deploy a service. See [deployment](./docs/deployment.md)
for setup and current validation limits.

Readers can comment on selected text or the document and edit shared notes. Threads
open in floating popups beside their text; the Comments button opens a compact list.
Any reader can delete a reply or delete a whole thread with its replies, after an
inline confirmation. The page
loads state once, applies local mutation results, and requires a reload to see other
readers' changes. A `<Todo task="release.verify" label="Verify the release" />` uses an explicit stable task key.
It stays disabled until the collaboration client loads state. GFM task lists do not
receive shared state. See the [component guide](./docs/components.md) for key rules.

### Migrating documents

Use `planloft migrate proposal.md --out proposal.mdx --dry-run` to check a one-way
Markdown-to-MDX conversion. Without `--dry-run`, it creates the destination and a
backup beside the source, without replacing unrelated files. It preserves code and
common GFM syntax and reports raw HTML for review. Existing HTML stays HTML. See
[document migration](./docs/installation-migration.md#document-migration).
