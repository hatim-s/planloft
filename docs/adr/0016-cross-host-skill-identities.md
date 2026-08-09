# ADR-0016 — cross-host Planloft skill identities

- **Status**: Accepted
- **Date**: 2026-08-09
- **Amends**: ADR-0012 installer matrix and ADR-0015 skill inventory

## Context

Planloft 0.2.1 used the portable names `write-doc` and `customize`. Codex could show
product-qualified labels through `agents/openai.yaml`, but Claude Code and other Agent
Skills hosts exposed the unqualified portable names.

The Agent Skills name contract allows lowercase letters, digits, and hyphens and
requires the frontmatter name to match the parent directory. Claude Code derives a
standalone skill command from that portable identity. Pi uses the same identity and
registers it under `/skill:<name>`. Neither host consumes Codex's OpenAI UI metadata.

## Decision

### I1 — Qualify the portable identities

Rename the two skill directories and frontmatter names to `planloft-write-doc` and
`planloft-customise`. Treat `write-doc`, `customize`, and `customise` as retired names
that migration instructions remove before installation.

### I2 — Preserve native host presentation

Keep Codex display names `planloft:write-doc` and `planloft:customise` in
`agents/openai.yaml`. Claude Code exposes `/planloft-write-doc` and
`/planloft-customise`. Pi exposes `/skill:planloft-write-doc` and
`/skill:planloft-customise`. Other standards-based hosts use the portable hyphenated
identities unless they provide their own presentation metadata.

Do not put colons in portable frontmatter names or directories and do not restore a
plugin solely to obtain Claude plugin namespacing.

### I3 — Add Pi to installer conformance

Add Pi as an explicit installer target. The contract matrix grows from 96 to 144 cases
across the existing runners, scopes, copy modes, CLI states, and sources. The quick live
matrix must cover Pi along with Codex and Claude Code.

## Consequences

- The repository remains a direct Agent Skills source for every supported host.
- Codex retains concise product-qualified labels without constraining portable names.
- Existing 0.2.1 skill installs require a one-time remove and reinstall.
- Installer tests validate Pi's project and global discovery paths.
