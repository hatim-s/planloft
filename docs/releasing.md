# Release Planloft 0.1.0

This checklist prepares the `planloft@0.1.0` npm package and the matching `v0.1.0`
repository release. The package and tag are independent release gates: do not advertise
the release or run the source-all installer gate until both exist.

## 1. Pin a fresh checkout to `origin/main`

Confirm Node 18 or newer and the repository's pinned pnpm version are active. From any
clean checkout of this repository, fetch `origin/main`, record the one commit being
released, and create a detached disposable worktree at exactly that commit. All install,
validation, packing, publishing, and release-gate commands below run in this pinned
checkout.

```bash
set -eu
RELEASE_SOURCE_ROOT="$(git rev-parse --show-toplevel)"
git fetch origin main
RELEASE_COMMIT="$(git rev-parse origin/main)"
RELEASE_TMP_PARENT="${TMPDIR:-/tmp}"
RELEASE_ROOT="$(mktemp -d "$RELEASE_TMP_PARENT/planloft-release.XXXXXX")"
RELEASE_CHECKOUT="$RELEASE_ROOT/checkout"
RELEASE_ARTIFACTS="$RELEASE_ROOT/artifacts"
RELEASE_PNPM_STORE="$RELEASE_ROOT/pnpm-store"
NPM_CONFIG_CACHE="$RELEASE_ROOT/npm-cache"
XDG_CACHE_HOME="$RELEASE_ROOT/xdg-cache"
export NPM_CONFIG_CACHE XDG_CACHE_HOME
mkdir -p "$RELEASE_ARTIFACTS" "$RELEASE_PNPM_STORE"
git worktree add --detach "$RELEASE_CHECKOUT" "$RELEASE_COMMIT"
cd "$RELEASE_CHECKOUT"
test "$(git rev-parse HEAD)" = "$RELEASE_COMMIT"
test -z "$(git status --porcelain=v1 --untracked-files=all)"
test "$(node -p "require('./package.json').version")" = "0.1.0"
pnpm install --frozen-lockfile --store-dir "$RELEASE_PNPM_STORE"
```

Before building anything:

1. Confirm the npm account is authenticated, has publish access to the unscoped
   `planloft` package, and has 2FA/automation-token requirements satisfied:

   ```bash
   npm whoami
   npm access list packages
   npm view planloft@0.1.0 version
   ```

   A `404` for the exact version is expected before first publication. Authentication,
   ownership, package-name availability, and registry policy are external checks; the
   repository test suite cannot prove them.
2. Confirm `package.json`, `planloft --version`, both plugin manifests, both marketplace
   npm pins, README recipes, and this checklist all say `0.1.0` / `v0.1.0`.

## 2. Deterministic validation and package inspection

Run the complete suite in the pinned checkout before publication:

```bash
pnpm test
pnpm typecheck
pnpm build
pnpm test:public-api
pnpm test:installer
pnpm test:installer:live
```

Create the exact candidate tarball once, capture npm's filename and digests, inspect it,
and exercise the packed plugin bridge and resolver. Keep this candidate until all
post-publication verification is complete.

```bash
PACK_JSON="$(npm pack --json --ignore-scripts --pack-destination "$RELEASE_ARTIFACTS")"
CANDIDATE_FILENAME="$(node -e 'const p=JSON.parse(process.argv[1])[0]; process.stdout.write(p.filename)' "$PACK_JSON")"
CANDIDATE_SHASUM="$(node -e 'const p=JSON.parse(process.argv[1])[0]; process.stdout.write(p.shasum)' "$PACK_JSON")"
CANDIDATE_INTEGRITY="$(node -e 'const p=JSON.parse(process.argv[1])[0]; process.stdout.write(p.integrity)' "$PACK_JSON")"
CANDIDATE_PATH="$RELEASE_ARTIFACTS/$CANDIDATE_FILENAME"
test "$CANDIDATE_FILENAME" = "planloft-0.1.0.tgz"
test -f "$CANDIDATE_PATH"
node scripts/validate-packed-plugin.mjs "$CANDIDATE_PATH"
npm publish --dry-run "$CANDIDATE_PATH"
```

Verify the preview still contains exactly the intended 29 package entries and one
discoverable `skills/write-plan/SKILL.md`. The `PACK_JSON`, candidate path, shasum, and
integrity variables are the release record; do not run `npm pack` again.

## 3. Publish, then tag the exact published commit

Immediately before publishing, fetch `origin/main` again and abort unless the worktree
is still clean, its HEAD and the remote main ref both equal the recorded commit, the
package version is unchanged, and the retained candidate bytes match both recorded npm
digests:

```bash
git fetch origin main
test -z "$(git status --porcelain=v1 --untracked-files=all)"
test "$(git rev-parse HEAD)" = "$RELEASE_COMMIT"
test "$(git rev-parse origin/main)" = "$RELEASE_COMMIT"
test "$(node -p "require('./package.json').version")" = "0.1.0"
CURRENT_CANDIDATE_SHASUM="$(shasum -a 1 "$CANDIDATE_PATH" | awk '{print $1}')"
CURRENT_CANDIDATE_INTEGRITY="sha512-$(openssl dgst -sha512 -binary "$CANDIDATE_PATH" | openssl base64 -A)"
test "$CURRENT_CANDIDATE_SHASUM" = "$CANDIDATE_SHASUM"
test "$CURRENT_CANDIDATE_INTEGRITY" = "$CANDIDATE_INTEGRITY"
npm publish --access public "$CANDIDATE_PATH"
PUBLISHED_METADATA="$(npm view planloft@0.1.0 dist.shasum dist.integrity --json)"
PUBLISHED_SHASUM="$(node -e 'const p=JSON.parse(process.argv[1]); process.stdout.write(p["dist.shasum"])' "$PUBLISHED_METADATA")"
PUBLISHED_INTEGRITY="$(node -e 'const p=JSON.parse(process.argv[1]); process.stdout.write(p["dist.integrity"])' "$PUBLISHED_METADATA")"
test "$PUBLISHED_SHASUM" = "$CANDIDATE_SHASUM"
test "$PUBLISHED_INTEGRITY" = "$CANDIDATE_INTEGRITY"
test "$(git rev-parse origin/main)" = "$RELEASE_COMMIT"
git tag -a v0.1.0 "$RELEASE_COMMIT" -m "planloft v0.1.0"
test "$(git rev-parse 'v0.1.0^{}')" = "$RELEASE_COMMIT"
git push origin "refs/tags/v0.1.0:refs/tags/v0.1.0"
```

The annotated tag explicitly targets `RELEASE_COMMIT`; its dereferenced commit must
match before the exact tag ref is pushed. If npm publication or either byte-for-byte
digest comparison fails, do not create or push the tag. If the package publishes but
tagging fails, repair the tag gate before announcing the release.

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

Keep the candidate until the source-all gate and fresh-session checks pass. Then return
to the original checkout and remove only the validated disposable release directory:

```bash
cd "$RELEASE_SOURCE_ROOT"
test -n "$RELEASE_ROOT"
test -n "$RELEASE_CHECKOUT"
case "$RELEASE_ROOT" in
  "$RELEASE_TMP_PARENT"/planloft-release.*) ;;
  *) echo "Refusing to remove unexpected release path: $RELEASE_ROOT" >&2; exit 1 ;;
esac
test "$RELEASE_CHECKOUT" = "$RELEASE_ROOT/checkout"
git worktree remove "$RELEASE_CHECKOUT"
rm -rf -- "$RELEASE_ROOT"
```
