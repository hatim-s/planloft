# planloft repository docs

This directory is public in the source repository, but it is not the consumer install
surface for planloft.

## Segments

### Consumer and publishable surface

These files are read by users installing or running planloft:

- `README.md`
- `package.json` metadata
- `.claude-plugin/`, `.codex-plugin/`, and `.agents/plugins/` marketplace metadata
- `skills/`
- `hooks/`
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
appear in install docs, plugin descriptions, skill instructions, or CLI
help until they are actually supported.

Maintainers preparing a release must follow the [operator release
runbook](./releasing.md). It pins one candidate to one `origin/main` commit, verifies
the published registry bytes before tagging, and records the release evidence.

### Local or generated surface

These are not committed as source:

- `dist/` generated build output, included in the npm package after build
- `node_modules/`
- `.planloft-test/`
- logs and local environment files

## Package boundary

`package.json#files` is the npm publish boundary. It intentionally includes runtime and
plugin assets, not `docs/`. npm still includes `README.md`, `LICENSE`, and `package.json`
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
pnpm test:installer       # 96-case contract enumeration, no network or global writes
pnpm test:installer:live  # six pairwise lifecycle cases against this checkout

# Run only after publishing the npm version and matching repository tag:
PLANLOFT_RELEASE_TAG=v0.1.0 pnpm test:installer:release
```

Every live case creates and removes its own temporary project, `HOME`, Planloft home,
and npm/pnpm/Bun caches. It installs and inspects only the case's named agent. With one
target, `skills@1.5.22` normalizes the default mode and explicit `--copy` to a direct
copy at that agent's exact discovery path. The lifecycle is add, list, update, remove,
assert every canonical/agent path is absent, and reinstall; hook/config state must stay
untouched throughout skill-only installation.

After building and packing, execute the extracted full-plugin bridge rather than merely
inspecting tar entries:

```bash
node scripts/validate-packed-plugin.mjs /path/to/planloft-0.1.0.tgz
```

The release suite intentionally fails without `PLANLOFT_RELEASE_TAG`. It compares the
installed tagged skill byte-for-byte with the tag's raw `SKILL.md`; it does not infer a
skill pin from the npm version. After the suite passes, start fresh Codex and Claude
sessions and confirm `write-plan` is visible. Agent discovery has no stable noninteractive
cross-host command, so that reload check remains a manual release assertion.
