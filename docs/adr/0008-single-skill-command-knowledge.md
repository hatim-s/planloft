# ADR-0008 — single semantic skill, authoritative command knowledge, and dual-theme output

- **Status**: Accepted
- **Date**: 2026-08-08
- **Supersedes**: ADR-0002 §E4 and ADR-0004's five-skill surface
- **Amends**: ADR-0001 §D1, §D9, §D16, and §D23

## Context

Planloft shipped semantic capture skills beside thin preview, copy, and deploy wrappers.
Those wrappers duplicated one CLI invocation each and made command discovery drift
across skills, plugin metadata, README prose, and Commander help. Agent-authored plans
also inherited a configurable HTML authoring path even though the canonical document
pipeline can render safer, diff-friendly Markdown.

Generated artifacts had light-only built-in themes. That made appearance depend on a
single palette even when the browser or reader preferred dark mode.

## Decision

### G1 — Keep one semantic skill

Ship only `write-plan`. Trigger it for substantial implementation, migration,
refactor, architecture, and design plans worth retaining. Remove `save-doc` and the
preview, copy, and deploy wrapper skills. Non-plan documents use `planloft hoist`.

Hooks continue to nudge only substantial plan-mode output toward `write-plan`.

### G2 — Keep operations in the CLI

Retain render, hoist, publish, list, preview, copy, deploy, remove, resolve,
configuration, and initialization as CLI commands. Retire Claude slash-command aliases
for preview, copy, and deploy. `planloft help` is the discovery boundary.

### G3 — Centralize command knowledge

Represent each public command's category, purpose, input, state transition, local and
external write effects, destructiveness, defaults, examples, and safety/privacy notes
in one typed module. Derive root and per-command help from that module and verify its
README, skill, and plugin projections in tests.

### G4 — Author plans as Markdown

`write-plan` always writes a Markdown source with title, slug, kind, and status
frontmatter to the exact path returned by `planloft resolve`. Planloft renders HTML;
agents do not hand-author generated artifacts. The `resolve` format for plans is
therefore Markdown even if legacy configuration selects HTML for other document kinds.

### G5 — Make light and dark presentation mandatory

Every rendered artifact includes a theme toggle at the top, initially honors the
browser's `prefers-color-scheme`, and declares both color schemes. Built-in themes
provide deliberate light and dark palettes. A custom theme without the dual-scheme
marker receives a readable system-color fallback.

### G6 — Keep installation products distinct

Treat CLI-only installation, installation of only `write-plan` through the external
`skills` runner, and full-plugin installation as different capability sets. Installing
the skill alone does not install the CLI, hooks, themes, or plugin assets. Publishing
and deployment remain explicit, user-authorized GitHub writes.

## Consequences

- The npm package has one discoverable skill directory and no slash-command wrappers.
- Agents learn non-semantic operations from `planloft help` instead of duplicated skill
  instructions.
- CLI and plugin users share the same command behavior and safety language.
- Direct Markdown, JSON, explicitly trusted HTML, all document kinds, canonical
  ingestion, project identity, themes, hooks, and GitHub Pages publication remain.
- The storage-path contract stays authoritative: agents must call `resolve` and never
  guess it.
