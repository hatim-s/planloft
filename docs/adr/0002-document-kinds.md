# ADR-0002 — generalize the store from plans to documents

- **Status**: Accepted except E4, superseded by ADR-0008
- **Date**: 2026-07-02
- **Amends**: ADR-0001 §D3 (store layout), §D6 (capture). Does **not** supersede §D7.

---

## Context

planloft began as a plan store. In practice the agent produces other durable documents
the user wants to re-read and share — ADRs, code/design reviews, research writeups,
reports, notes. Restricting the store to "plans" left those homeless. This ADR
generalizes the store to arbitrary **documents** while keeping the plan flow intact.

## Decision log

### E1 — Store layout: flat, `kind` as a frontmatter tag
Rename the top-level store dir `plans/` → `docs/`. Layout stays **flat** per project:
`~/.planloft/docs/<project>/<slug>.md`. The document type is a `kind:` field in
frontmatter, **not** a directory level.
**Consequences.** Simple browsing; `list --kind` filters logically. Slugs are unique per
project across all kinds, so two docs cannot share a slug — capture skills are told to
choose distinct, kind-prefixed slugs (e.g. `adr-0003-caching`). *Amends ADR-0001 §D3.*
**Rejected.** Kind as a directory namespace (`docs/<project>/<kind>/<slug>`) — more
structural but heavier; the user preferred flat.

### E2 — Kinds: built-in set + open
Built-in kinds: `plan`, `adr`, `review`, `research`, `report`, `note`. Any string is also
a valid kind; unknown kinds fall back to the generic authoring template + the default
theme. Teams can use `rfc`, `postmortem`, etc. without a release.
**Rejected.** A closed enum (can't capture unforeseen types without shipping).

### E3 — Authoring template stays theme-driven; kind is organizational only
ADR-0001 §D7 stands: a **theme** provides the authoring template *and* the visual skin.
`kind` does **not** change document structure — it is an organizational tag for
browsing, filtering, and deploy. An ADR and a plan authored under the same theme share
structure; they differ only by tag (and how the author naturally writes them).
**Consequences.** Simplest model; no per-kind template maintenance. Trade-off: a doc
tagged `adr` does not automatically get a canonical ADR skeleton — that is left to the
author/theme.
**Rejected.** Decoupling kind (structure) from theme (skin) — cleaner per-kind structure
but more moving parts; the user chose simplicity. Per-(kind×theme) template matrix —
combinatorial explosion.

### E4 — Capture: keep plan auto-capture; add one generic `save-doc` skill
> **Superseded by [ADR-0008](./0008-single-skill-command-knowledge.md).** Non-plan
> documents now use the explicit `planloft hoist` command.

The `write-plan` skill and its ExitPlanMode backstop are unchanged (§D6): plans still
auto-capture. A single new **`save-doc`** skill handles every other kind. It triggers
when the user asks to save/keep a doc, or when the agent finishes a substantial
standalone document, and calls `planloft resolve --kind <kind>`. `resolve` gains a
`--kind` flag (default `plan`).
**Rejected.** A dedicated skill per kind (N skills to maintain, trigger overlap/noise).

## Consequences (implementation)

- Types: `PlanMeta` → `DocMeta` (adds `kind`); `ProjectEntry.plans` → `docs`;
  `ResolvedContext` adds `kind`.
- `core/plan.ts` → `core/doc.ts` (`docDir`, `docFile`, `normalizeDocFile`).
- `store.ts`: `upsertDoc` / `getDoc` / `latestDoc` / `removeDoc`.
- `paths.ts`: `plansDir()` → `docsDir()`.
- Hook indexes **any** doc written under `~/.planloft/docs/` (kind read from frontmatter,
  default `note`).
- Renderer env: `PLANLOFT_PLAN_*` → `PLANLOFT_DOC_*` (+ `PLANLOFT_DOC_KIND`).
- `list --kind`, `resolve --kind`; new `skills/save-doc/`.

## Deferred

- Per-kind default templates/themes (would revisit E3) if flat tagging proves too coarse.
- `list` sort/group by kind; a `--kind` filter on `copy`/`deploy` is unnecessary (slug is
  unique per project).
