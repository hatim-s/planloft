# How Planloft works and is customized

## Core pipeline

Planloft has one canonical document seam:

```text
Markdown | trusted MDX | JSON envelope | explicitly trusted HTML
                       |
                       v
              CanonicalDocument v1
                 /      |      \
                /       |       \
          render      hoist     publish
          (HTML)      (store)   (store + HTML + GitHub Pages)
```

Every input adapter normalizes title, slug, kind, theme, status, content format,
content, and trust metadata before downstream work. JSON is a metadata envelope around
Markdown, trusted MDX, or trusted HTML, not a proprietary content tree.

## Operations

- `render` creates self-contained HTML without storing or publishing.
- `hoist` normalizes a source and persists it in the current project's store.
- `publish` validates, hoists, renders, and publishes a source in one explicit action.
- `preview` renders a stored document and opens a local file.
- `copy` copies stored source into the current repository.
- `deploy` publishes an already stored document.
- `resolve` returns the source path and selected theme CSS used by
  `planloft-write-doc`.
- `init` creates defaults when absent and reports readiness; it does not publish.

Use `planloft help <command>` for current inputs, defaults, examples, and effect
markers. Do not duplicate thin CLI operations as skills.

## Storage and project identity

Planloft's home is `PLANLOFT_HOME` when set, otherwise the user's `.planloft`
directory. It contains strict versioned configuration, a project/document index,
stored document sources, user themes, and local publication working state.

Documents are grouped by project. Project identity prefers the canonical Git remote
and falls back to a path-derived identity outside Git. Agents must use `planloft
resolve` for a write target instead of guessing store paths.

## Themes

Theme resolution is:

```text
document theme > project override > global default
```

A user theme directory overrides a built-in theme with the same name. Planloft rejects
invalid, missing, inaccessible, or structurally invalid themes rather than silently
falling back. See [themes.md](themes.md) for the asset contract.

The renderer owns Markdown parsing, safe URL handling, a shared prose shell,
light/dark support, the theme toggle, optional `noindex` metadata, and optional giscus
comments. A rendered artifact is self-contained.
Authored HTML retains its structure, styles, and scripts while the renderer supplies theme CSS and controls. It can opt into semantic styling with `.planloft-prose` and reading/full-width support with `.planloft-plan > article`.

## Agent boundary

`planloft-write-doc` is the semantic authoring skill. It resolves the target, writes
durable Markdown or hoists trusted MDX with its dependency snapshot, and never publishes unless separately asked. `planloft-customise`
explains the system and works on themes. All other behavior remains discoverable
through the CLI.

Installing a skill does not install the CLI or runtime assets. Codex UI metadata labels
the skills `planloft:write-doc` and `planloft:customise`; other Agent Skills hosts use
the portable `planloft-write-doc` and `planloft-customise` names.

## Trust and publication

Untrusted Markdown escapes embedded HTML and rejects unsafe link and image schemes.
Raw HTML requires an explicit trusted-HTML option and should be used only for content
the user controls.

Publishing is always explicit. Published paths are hard to guess. Published Markdown, MDX, and HTML get `noindex`.
The backing GitHub repository and manifest are public and enumerable. Keep
sensitive documents local.

## MDX and collaboration

MDX imports and expressions execute code. Use `--trusted-mdx` only for trusted
source, imports, registries, and stored or copied bundles. Hoist compiles a minified,
self-contained snapshot that includes the component runtime. Stored documents render
from that pinned snapshot; hoist again from source to pick up edits, component fixes,
or a Planloft upgrade. Rendering or hoisting a source path compiles from source first
and uses an adjacent snapshot only when an import is missing.
Components imported from `planloft/components` and local files render static HTML.
Project `.planloft/components/index.tsx` overrides the global
`~/.planloft/components/index.tsx`, which overrides built-ins.

Collaboration is opt-in. Access is public and anonymous: any viewer can comment,
delete any comment or thread, create and edit notes, and tick shared tasks. State loads once;
local changes update the view and a reload fetches other readers' changes. Checkbox
state uses explicit stable task keys; `Todo`s with the same key share one state. Credentials belong on the server, never in HTML.
