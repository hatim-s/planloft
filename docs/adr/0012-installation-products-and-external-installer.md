# ADR-0012 — installation products and the external skills installer

- **Status**: Accepted
- **Date**: 2026-08-08
- **Amends**: ADR-0001 D1 and D23, ADR-0008 G6

## Context

Planloft is distributed through three mechanisms with different effects. npm package
managers install a runtime, the external `skills` CLI copies or links instructions into
agent discovery paths, and Codex/Claude plugin marketplaces install a package bundle.
Treating those mechanisms as interchangeable caused recipes to imply that a standalone
skill also installed an executable or hooks.

The external `skills` CLI 1.5.22 has stable noninteractive add, list, update, remove,
project/global, Codex/Claude, and copy/symlink surfaces. Planloft has no evidence that a
first-party setup command would improve that contract enough to justify duplicating its
agent path and lockfile behavior.

## Decision

### I1 — Define three products

- **CLI-only** is the `planloft` npm package installed globally. It provides the
  executable and library plus themes, schemas, renderer, store, and publication code.
- **Skill-only** is `skills/write-plan` installed from GitHub by the external `skills`
  CLI. It provides instructions only and requires a separate CLI installation.
- **Full plugin** is the Planloft npm artifact selected through a Codex or Claude
  marketplace. It provides the built CLI and runtime dependencies, one skill, hooks,
  themes, schemas, and plugin metadata.

The Codex and Claude marketplace catalogs live in this repository, but their Planloft
entries use an exact npm version. Updating `package.json` therefore also requires
updating both catalog entries before release.

### I2 — Keep GitHub skill and npm versions independent

`hatim-s/planloft` means the repository's current default branch. A reproducible skill
install uses a tagged tree URL ending in `/skills/write-plan`. An npm version pin only
pins the CLI/full-plugin package; it does not pin a GitHub-sourced skill.

Release verification must prove the tag exists and contains exactly `write-plan`. The
repository currently has no release tag, so development verification may use the local
checkout, while tagged installation remains a release gate.

### I3 — Maintain a disposable conformance matrix

`scripts/installer-matrix.mjs` owns the matrix across runner, agent, scope, install
method, CLI state, and source version. Every case uses a temporary project, home,
Planloft home, and package-manager caches. It asserts one installed skill named
`write-plan`, exact source content, agent discovery paths, CLI prerequisite behavior,
absence of plugin assets and hook-install claims, and add/list/update/remove/reinstall
lifecycle behavior.

The contract suite enumerates the full 96-case product. A quick live suite covers every
dimension value against the local checkout. The release suite exercises the full live
latest/tag matrix and requires `PLANLOFT_RELEASE_TAG`.

### I4 — Defer `planloft setup`

Do not add `planloft setup --agent ...` in this release. Reconsider only after repeated
installer failures demonstrate a gap that cannot be fixed with recipes, migration
guidance, or the upstream installer.

## Consequences

- Skill-only installs cannot honestly claim hooks or runtime assets.
- Full plugin installation is gated on a published npm version and a marketplace refresh.
- Release tags and npm versions are deliberate, separate pins.
- Tests never mutate the user's real global skill directories.
