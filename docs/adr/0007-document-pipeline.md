# ADR-0007 — canonical document pipeline and constrained theme layouts

- **Status**: Accepted
- **Date**: 2026-08-05
- **Amends**: ADR-0001 §D7, §D9, §D16, §D24; ADR-0002 §E4.
- **Supersedes in part**: ADR-0003's fixed renderer input and fixed HTML wrapper.

---

## Context

Planloft's renderer and GitHub Pages host already turn stored Markdown or HTML into a
themed site. Callers other than the capture skills cannot use that capability without
first understanding the store layout, writing a file, and relying on a hook to index it.
The renderer also accepts a file-backed `DocMeta`, so parsing, storage, rendering, and
publishing are coupled.

We want scripts and other tools to provide a well-defined document source directly,
while keeping the agent capture workflow and existing store compatible.

## Decision

### F1 — Canonical document at the ingestion seam

Markdown, JSON, and trusted HTML ingestion adapters normalize their input into one
canonical document. The canonical document contains metadata and a Markdown or HTML
body, but no store path. Storage and rendering consume this representation.

JSON is an envelope, not a block tree. Version 1 contains top-level metadata,
`contentFormat`, and `content`. Markdown remains the default content format. This keeps
arbitrary prose diff-friendly and avoids a schema entry for every possible document
element.

### F2 — Safe direct rendering; trusted HTML is explicit

Direct Markdown rendering escapes embedded HTML and rejects unsafe link/image schemes.
HTML sources, and JSON sources whose `contentFormat` is `html`, require an explicit
trusted-HTML option. Existing stored documents remain compatible; newly hoisted input
records whether embedded HTML was trusted.

### F3 — Themes may provide a constrained layout

A theme may add `layout.html` alongside `template.md` and `style.css`. Layouts receive a
fixed set of escaped or renderer-owned slots. There are no expressions, conditionals,
includes, filesystem access, or executable code. A built-in layout is used when the
file is absent, preserving existing custom themes.

### F4 — Separate render, hoist, and publish workflows

- `render` converts a document source to a self-contained HTML artifact without
  touching the store.
- `hoist` normalizes and persists a document source in the current project's store.
- `publish` hoists and deploys a document source in one operation.

The existing preview/deploy flows continue to operate on stored documents.

### F5 — Library interface

The npm package exports ingestion, rendering, and hoisting entry points in addition to
the CLI. Hosting stays in the CLI workflow because it depends on local GitHub
credentials and configuration.

## Consequences

- All callers share parsing, validation, defaulting, slugging, and safety behavior.
- Rendering is testable without a filesystem-backed document.
- JSON callers get a stable envelope while themes retain control of presentation.
- Constrained layouts provide consistent structure without turning Planloft into an
  executable general-purpose template language.
- Adding another source format requires one real adapter at the ingestion seam.

## Rejected

- **JSON block/element tree** — couples the input schema to every content feature and
  creates avoidable migrations.
- **General-purpose templates** — expressions and code add sandboxing and portability
  burdens that are unnecessary for document presentation.
- **Treat all HTML as safe** — appropriate for the original trusted local workflow, but
  unsafe once arbitrary callers can publish input.
