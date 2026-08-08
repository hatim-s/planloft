# Release Planloft 0.1.0

This checklist prepares the `planloft@0.1.0` npm package and the matching `v0.1.0`
repository release. The package and tag are independent release gates: do not advertise
the release or run the source-all installer gate until both exist.

## 1. Preflight from clean `main`

1. Confirm every release pull request is merged, fetch the remote, and verify local
   `main` is exactly `origin/main` with no working-tree changes.
2. Confirm Node 18 or newer and the repository's pinned pnpm version are active.
3. Confirm the npm account is authenticated, has publish access to the unscoped
   `planloft` package, and has 2FA/automation-token requirements satisfied:

   ```bash
   npm whoami
   npm access list packages
   npm view planloft@0.1.0 version
   ```

   A `404` for the exact version is expected before first publication. Authentication,
   ownership, package-name availability, and registry policy are external checks; the
   repository test suite cannot prove them.
4. Confirm `package.json`, `planloft --version`, both plugin manifests, both marketplace
   npm pins, README recipes, and this checklist all say `0.1.0` / `v0.1.0`.

## 2. Deterministic validation and package inspection

Run the complete local suite before publication:

```bash
pnpm test
pnpm typecheck
pnpm build
pnpm test:public-api
pnpm test:installer
pnpm test:installer:live
npm pack --dry-run
```

Create the exact candidate tarball in a disposable directory, inspect it, and exercise
the packed plugin bridge and resolver:

```bash
RELEASE_DIR="$(mktemp -d)"
npm pack --pack-destination "$RELEASE_DIR"
node scripts/validate-packed-plugin.mjs "$RELEASE_DIR/planloft-0.1.0.tgz"
npm publish --dry-run "$RELEASE_DIR/planloft-0.1.0.tgz"
```

Verify the preview still contains exactly the intended 29 package entries and one
discoverable `skills/write-plan/SKILL.md`. Record the candidate tarball's filename,
size, shasum, and integrity from `npm pack --json` for the release notes.

## 3. Publish, then tag the exact published commit

Only after the checks above pass from clean `main`:

```bash
npm publish --access public "$RELEASE_DIR/planloft-0.1.0.tgz"
npm view planloft@0.1.0 version dist.shasum dist.integrity
git tag -a v0.1.0 -m "planloft v0.1.0"
git push origin v0.1.0
```

Do not tag a different commit from the one used to build the published tarball. If npm
publication fails, do not create or push the tag. If the package publishes but tagging
fails, repair the tag gate before announcing the release.

## 4. Validate the released installation surfaces

After both npm and GitHub expose the release, run all 96 source/package-manager/agent/
scope/method/CLI-state combinations:

```bash
PLANLOFT_RELEASE_TAG=v0.1.0 pnpm test:installer:release
```

Then start fresh Codex and Claude Code sessions and verify:

- the tagged `write-plan` skill is visible in each agent;
- Codex and Claude marketplace catalogs resolve npm `planloft@0.1.0`;
- a full-plugin install exposes exactly one skill and its bundled bridge reports
  `0.1.0`;
- skill-only installs do not add hooks or a global CLI;
- removal and reinstall leave no stale retired skills or aliases.

Agent/plugin visibility is a manual fresh-session assertion because neither host has a
stable cross-host noninteractive discovery command.
