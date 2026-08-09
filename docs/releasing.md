# Release Planloft 0.1.0

This guide publishes `planloft@0.1.0` to npm and creates the matching Git tag
`v0.1.0`. Run every step from the repository root, in the same terminal.

Publishing to npm and pushing the tag are the only irreversible steps. Everything
before them is preparation or verification.

## Before you start

You need:

- Node.js 18 or newer and the pnpm version declared in `package.json`.
- An npm account allowed to publish the `planloft` package.
- Permission to push tags to the GitHub repository.
- A clean `main` branch with all release changes already merged.

Log in and check the two release destinations:

```bash
npm login
npm whoami
npm view planloft@0.1.0 version
git ls-remote --tags origin v0.1.0
```

Expected:

- `npm whoami` prints your npm username.
- `npm view` returns `E404` because `0.1.0` has not been published yet.
- `git ls-remote` prints nothing because `v0.1.0` does not exist yet.

Stop if npm reports an authentication/permission error, the version already exists,
or the tag already exists.

## 1. Sync and verify `main`

```bash
git switch main
git pull --ff-only origin main
git status --short
node -p "require('./package.json').version"
```

What this does: makes the release use the latest merged commit.

Expected: `git status --short` prints nothing and the version command prints `0.1.0`.

## 2. Install dependencies and run the release checks

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm test:public-api
pnpm test:installer
pnpm test:installer:live
```

What this does: verifies the source, public Node API, CLI, package declarations, and
local Codex/Claude installation paths.

Expected: every command exits successfully. Do not publish if any check fails.

## 3. Build one package candidate

```bash
RELEASE_DIR="$(mktemp -d)"
npm pack --pack-destination "$RELEASE_DIR"
CANDIDATE="$RELEASE_DIR/planloft-0.1.0.tgz"
test -f "$CANDIDATE"
tar -tf "$CANDIDATE" | sort
node scripts/validate-packed-plugin.mjs "$CANDIDATE"
npm publish --dry-run "$CANDIDATE"
```

What this does: builds the exact tarball that will be published, lists its contents,
validates the packed plugin, and asks npm to simulate publication.

Expected:

- npm creates `planloft-0.1.0.tgz`.
- The package contains 29 entries and only one skill: `skills/write-plan`.
- The packed-plugin validator passes.
- The dry run ends with `+ planloft@0.1.0` without publishing anything.

Keep this terminal open. The `CANDIDATE` variable is used in the next step.

## 4. Recheck, then publish to npm

First confirm that neither the checkout nor the external release state changed:

```bash
git fetch origin main --tags
test -z "$(git status --short)"
test "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)"
test "$(node -p 'require("./package.json").version')" = "0.1.0"
npm view planloft@0.1.0 version
git ls-remote --tags origin v0.1.0
```

Expected: the first three `test` commands are silent, `npm view` returns `E404`, and
the tag lookup prints nothing. Any other result means stop and investigate.

When those results are correct, publish the candidate:

```bash
npm publish --access public "$CANDIDATE"
```

Expected: npm prints `+ planloft@0.1.0`.

If the command times out or the result is unclear, do not immediately retry. Run
`npm view planloft@0.1.0 version` first to learn whether npm accepted it.

## 5. Verify npm, then create the Git tag

```bash
npm view planloft@0.1.0 version dist.shasum dist.integrity
RELEASE_COMMIT="$(git rev-parse HEAD)"
git tag -a v0.1.0 "$RELEASE_COMMIT" -m "planloft v0.1.0"
git push origin v0.1.0
git ls-remote --tags origin v0.1.0
```

What this does: confirms npm can serve the new package, then tags the exact commit that
produced it.

Expected: npm reports version `0.1.0`, the push creates `v0.1.0`, and the final lookup
shows the tag.

Never move or force-push a published release tag. If the npm package is wrong, fix it
in a new version.

## 6. Verify released installation paths

```bash
PLANLOFT_RELEASE_TAG=v0.1.0 pnpm test:installer:release
```

What this does: installs from the real npm package and Git tag instead of the local
checkout.

Expected: the full release installation matrix passes. Then start fresh Codex and
Claude sessions and confirm that `write-plan` is visible in each host you support.

## 7. Clean up

```bash
rm "$CANDIDATE"
rmdir "$RELEASE_DIR"
```

Expected: both commands are silent. The published npm version and Git tag remain.

## If a step fails

- Before npm publication: fix the problem, merge it to `main`, and restart from step 1.
- npm result is unclear: check `npm view planloft@0.1.0 version` before retrying.
- npm published but tagging failed: fix Git access, then tag the same release commit.
- A released artifact is wrong: do not replace the npm version or move the tag; prepare
  the next version.
