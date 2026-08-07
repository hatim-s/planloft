# ADR-0011 — Markdown capture and repository-root persistence contracts

- **Status**: Accepted
- **Date**: 2026-08-08
- **Supersedes**: ADR-0001 §D9
- **Amends**: ADR-0001 §D17; ADR-0007 §F1–F2; ADR-0010 §H1

## Context

The global `planFormat` setting let agent capture resolve an HTML target even though the
remaining semantic skill is specifically responsible for authoring reviewable plans.
Direct callers still need an explicit trusted-HTML ingestion path, and existing indexed
HTML documents must remain useful. Copy also described the repository root as its target
but used the process directory, while runtime document metadata validation did not match
the shipped JSON Schema for present blank values.

## Decision

### I1 — Agent write-direct capture is Markdown-only

`resolve` always returns a Markdown path and every theme authoring template requires
Markdown. Configuration no longer contains `planFormat`. A configuration that still
contains the former setting fails with `PLANLOFT_CONFIG_MIGRATION_REQUIRED`; the
diagnostic directs users to remove it and explains the explicit `--trusted-html` path.

Markdown-only capture does not remove HTML from the canonical document language. Direct
HTML input and JSON with `contentFormat: "html"` still require explicit trust. Indexed
HTML documents, including entries created before trust metadata was recorded, remain
readable and deploy-renderable.

### I2 — Copy targets the actual Git root

`copy` resolves the current worktree's Git root and writes the exact stored bytes to
`<git-root>/.planloft/plans/<source-name>`. A repository without an `origin` still uses
its Git root. Outside Git, copy uses the current directory and prints that fallback.
Existing destinations are not replaced unless the caller passes `--force`.

### I3 — Version and align the document envelope

The version-1 JSON Schema is `schemas/document.v1.schema.json`, identified by
`https://github.com/hatim-s/planloft/schemas/document.v1.schema.json`. A change to the
accepted document language requires a new schema version rather than silently changing
this identity.

When present, `title`, `slug`, `kind`, `theme`, and `status` must be strings containing
at least one non-whitespace character. Runtime ingestion trims surrounding whitespace
before using these values. Omission remains valid. Markdown title inference uses the
first parsed level-one heading only, then falls back to slug and source filename. JSON
unknown fields and unsupported versions remain errors. Shared fixtures run through the
runtime, the actual JSON Schema, and CLI source flags.

## Consequences

- Agents always author diff-friendly Markdown while explicit trusted callers retain HTML.
- Existing HTML store entries can still be previewed and deployed.
- Copy behaves consistently from repository roots, nested directories, and worktrees,
  and replacement is an explicit choice.
- Runtime and schema validation share one tested metadata language and schema identity.
