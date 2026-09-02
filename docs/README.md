# planloft repository docs

This directory is public in the source repository, but it is not the consumer install
surface for planloft.

## Segments

### Consumer and publishable surface

These files are read by users installing or running planloft:

- `README.md`
- `package.json` metadata
- `skills/`
- `themes/`
- `schemas/`
- `templates/`
- the built `dist/` output

Keep this segment focused on shipped behavior only. It should not describe rejected
designs, deferred hosts, internal tradeoffs, or future-only architecture.

### Development surface

These files are public repo docs for maintainers and contributors:

- `docs/adr/`
- `CONTEXT.md`
- future planning, architecture, release, or investigation notes under `docs/`
- `scripts/installer-matrix.mjs` and its contract tests

This segment can record decision history, rejected options, deferred work, and
implementation rationale. It can mention future hosts or internal seams that should not
appear in install docs, skill instructions, or CLI
help until they are actually supported.

Maintainers publish with the single command documented in the [release
guide](./releasing.md). It updates the version, runs the release checks, pushes `main`,
publishes to npm, tags the commit, and verifies the remote skills.

### Local or generated surface

These are not committed as source:

- `dist/` generated build output, included in the npm package after build
- `node_modules/`
- `.planloft-test/`
- logs and local environment files

## Package boundary

`package.json#files` is the npm publish boundary. It intentionally includes runtime and
portable skill assets, not `docs/`. npm still includes `README.md`, `LICENSE`, and `package.json`
automatically, so those files must stay consumer-facing.

Before publishing, inspect the package contents with:

```bash
npm pack --dry-run
```

If a development doc appears in the package preview, remove it from the publishable
segment rather than diluting consumer-facing docs with internal caveats.

## Installation verification

The external skill installer is pinned in the verification harness so upstream changes
are reviewed deliberately:

```bash
bun run test:installer       # repository contract, no network or global writes
bun run test:installer:live  # 12 parallel local lifecycle scenarios
```

Each live scenario creates and removes its own temporary project and `HOME`. Four
workers run independent scenarios at once. The matrix covers npx, pnpm, Bun, Codex,
Claude Code, Pi, project and global scope, default and copy installs, both skills, and
Planloft CLI presence without testing every redundant combination.

After building and packing, execute the extracted CLI and portable skill resolver rather
than merely inspecting tar entries:

```bash
node scripts/validate-packed-package.mjs /path/to/planloft-<version>.tgz
```

After a release, start fresh Codex, Claude Code, and Pi sessions and confirm the
host-specific names in [setup](./setup.md) are visible. Agent discovery has no stable
noninteractive cross-host command, so that reload check remains manual.
