# ADR-0003 — replace the Astro renderer with a minimal `marked` renderer

- **Status**: Accepted; fixed input/wrapper partially superseded by ADR-0007
- **Date**: 2026-07-03
- **Supersedes**: ADR-0001 §D10 (assembler) and §D25 (renderer runtime).

---

## Context

ADR-0001 chose a bundled Astro static site as the assembler (§D10) and shipped it as a
prebuilt, vendored `node_modules` (§D25). That decision carried the project's #1 risk:
Astro pulls native binaries (`esbuild`, `sharp`) that are platform-specific, making a
bundled cross-OS `node_modules` fragile, plus a `vendor-renderer` publish step.

Two facts undercut the reason Astro was chosen:

1. The deploy unit is a **single doc** (§D14) — the deployed artifact has no multi-page
   nav, gallery, or SEO surface. Astro's site-framework strengths don't apply.
2. The renderer already used `marked` + `gray-matter` *inside* the Astro project.

MDX was considered and rejected: it is not a renderer but a format needing a compiler +
JSX runtime, so it is heavier, and its only benefit (JSX components in docs) is unwanted
for a static read/review store.

## Decision

Render each doc **in-process** with a ~40-line function: `gray-matter` for frontmatter,
`marked` for markdown→HTML (or pass-through for `planFormat: html`), the resolved theme's
`style.css` inlined, wrapped in a small HTML template (title, `noindex`, optional giscus
mount). Output is a single self-contained `index.html`. Both deps are pure JS.

- `render/renderer.ts#buildSite` keeps its signature (`{ doc, theme, base, comments,
  noindex }`) so `preview`/`deploy` are unchanged. `base` is now unused (self-contained
  page) but retained for interface stability.
- Deleted: the `renderer/` Astro project, `scripts/vendor-renderer.mjs`, `paths.rendererDir`,
  the `renderer` entry in `package.json#files`, and the `vendor:renderer` script.
- Added `marked` to the package's runtime deps.

## Consequences

- **Risk #1 (ADR-0001) is eliminated** — no native binaries, no vendored `node_modules`,
  nothing platform-specific to bundle or publish.
- Instant builds; trivial self-contained HTML (also serves the `planFormat: html` path).
- Trade-off: no JSX/components and no framework niceties in docs — acceptable for a
  static read/review store. If interactive components are ever needed, revisit.
- Theme contract is unchanged: themes still provide `template.md` (authoring) +
  `style.css` (skin). Only the *engine* that applies the skin changed.

## Rejected

- **Keep Astro + add MDX** — keeps all the weight and Risk #1 for component power we
  don't need.
- **Keep Astro as-is** — carries the native-binary/vendoring burden for no benefit at
  single-doc scale.
