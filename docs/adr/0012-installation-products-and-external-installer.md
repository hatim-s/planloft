# ADR-0012 — installation products and the external skills installer

- **Status**: Accepted
- **Date**: 2026-08-08
- **Amended by**: ADR-0015 installation inventory and Planloft 0.2.1 distribution cleanup; ADR-0016 portable skill identity and Pi coverage
- **Amends**: ADR-0001 D1 and D23, ADR-0008 G6

## Context

Planloft is distributed through two mechanisms with different effects. npm package
managers install a runtime, while the external `skills` CLI copies or links instructions
into agent discovery paths. Treating those mechanisms as interchangeable caused recipes
to imply that a standalone skill also installed an executable or runtime assets.

The external `skills` CLI 1.5.22 has stable noninteractive add, list, update, remove,
project/global, Codex/Claude, and copy/symlink surfaces. Planloft has no evidence that a
first-party setup command would improve that contract enough to justify duplicating its
agent path and lockfile behavior.

## Decision

### I1 — Define two products

- **CLI-only** is the `planloft` npm package installed globally. It provides the
  executable and library plus themes, schemas, renderer, store, and publication code.
- **Skill-only** is either focused skill installed from GitHub by the external `skills`
  CLI. It provides instructions only and requires a separate CLI installation for
  operations that execute Planloft.

### I2 — Keep GitHub skill and npm versions independent

`hatim-s/planloft` means the repository's current default branch. A reproducible skill
install uses a tagged tree URL ending in the selected skill directory. An npm version
pin only pins the CLI package; it does not pin a GitHub-sourced skill.

Release verification must prove the tag exists and contains exactly the focused skills.
Development verification may use the local checkout, while tagged installation remains
a release gate.

### I3 — Maintain disposable conformance scenarios

`scripts/installer-matrix.ts` owns 12 curated scenarios across runner, agent, scope,
default or explicit-copy install mode, CLI state, and both skills. Every scenario uses
a temporary project and home and installs only its selected agent. The scenarios assert
one selected installed skill, exact source content, actionable CLI prerequisite
behavior, and the add/list/update/remove/reinstall lifecycle.

The local suite runs 12 scenarios. Release verification distributes 12 scenarios across
the latest branch and the new tag instead of duplicating the suite for each source. Four
worker processes share package download caches while keeping installation homes isolated.

### I4 — Defer `planloft setup`

Do not add `planloft setup --agent ...` in this release. Reconsider only after repeated
installer failures demonstrate a gap that cannot be fixed with recipes, migration
guidance, or the upstream installer.

## Consequences

- Skill-only installs cannot honestly claim the CLI or runtime assets.
- Release tags and npm versions are deliberate, separate pins.
- Tests never mutate the user's real global skill directories.
