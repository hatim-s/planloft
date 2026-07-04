# planloft repository docs

This directory is public in the source repository, but it is not the consumer install
surface for planloft.

## Segments

### Consumer and publishable surface

These files are read by users installing or running planloft:

- `README.md`
- `package.json` metadata
- `.claude-plugin/` and `.codex-plugin/`
- `commands/`
- `skills/`
- `hooks/`
- `themes/`
- `templates/`
- the built `dist/` output

Keep this segment focused on shipped behavior only. It should not describe rejected
designs, deferred hosts, internal tradeoffs, or future-only architecture.

### Development surface

These files are public repo docs for maintainers and contributors:

- `docs/adr/`
- future planning, architecture, release, or investigation notes under `docs/`

This segment can record decision history, rejected options, deferred work, and
implementation rationale. It can mention future hosts or internal seams that should not
appear in install docs, plugin descriptions, slash commands, skill instructions, or CLI
help until they are actually supported.

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
