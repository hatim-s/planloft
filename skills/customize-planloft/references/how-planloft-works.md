# How Planloft works

## Core pipeline

Planloft has one canonical document seam:

```text
Markdown | JSON envelope | explicitly trusted HTML
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
Markdown or trusted HTML, not a proprietary content tree.

## Operations

- `render` creates self-contained HTML without storing or publishing.
- `hoist` normalizes a source and persists it in the current project's store.
- `publish` validates, hoists, renders, and publishes a source in one explicit action.
- `preview` renders a stored document and opens a local file.
- `copy` copies stored source into the current repository.
- `deploy` publishes an already stored document.
- `resolve` returns the exact Markdown path and theme authoring guidance used by
  `write-plan`.
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

The renderer owns Markdown parsing, safe URL handling, constrained layout slots,
light/dark support, the theme toggle, optional `noindex` metadata, and optional giscus
comments. A rendered artifact is self-contained.

## Agent boundary

`write-plan` is the semantic authoring skill. It resolves the target, writes durable
Markdown, and never publishes unless separately asked. `customize-planloft` explains
the system and works on themes. All other behavior remains discoverable through the
CLI.

Installing a skill does not install the CLI or runtime assets. Full Codex or Claude
plugin installation is not a supported setup path.

## Trust and publication

Untrusted Markdown escapes embedded HTML and rejects unsafe link and image schemes.
Raw HTML requires an explicit trusted-HTML option and should be used only for content
the user controls.

Publishing is always explicit. Published paths are hard to guess and marked `noindex`,
but the backing GitHub repository and manifest are public and enumerable. Keep
sensitive documents local.
