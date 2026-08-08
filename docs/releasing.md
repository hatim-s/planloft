# Planloft 0.1.0 release runbook

This is the maintainer runbook for publishing `planloft@0.1.0` to npm and creating
the matching repository tag, `v0.1.0`. It produces one tarball from one recorded
`origin/main` commit, publishes those exact bytes, verifies the registry digests, and
only then tags that exact commit.

> **Authorization boundary:** everything through the publish dry run is local or
> read-only. `npm publish` permanently creates a public package version, and
> `git push` publishes a repository tag. Run either command only when explicitly
> authorized for this release. An npm version cannot be overwritten, and a public
> tag must never be force-moved.

## Release-state overview

| Item | Release target | Expected pre-release state | Gate |
| --- | --- | --- | --- |
| Source/package version | `0.1.0` everywhere | Prepared on `origin/main` | Deterministic consistency |
| npm version | `planloft@0.1.0` | Exact version absent (`E404`) | External and irreversible |
| Repository tag | `v0.1.0` at `RELEASE_COMMIT` | Tag absent | External and irreversible |
| Test evidence | 105 source, 7 script, 96 installer contract, 6 live pairwise | All runnable before publish | Deterministic |
| Published bytes | Registry shasum and integrity equal candidate | No registry values yet | External equality |
| Host visibility | One `write-plan` skill in fresh Codex and Claude Code sessions | Unverified until npm and tag exist | Manual external |

## Prerequisites and operating assumptions

- A clean Planloft checkout with an `origin` remote that points to the canonical
  repository and permission to fetch `origin/main`.
- Node.js 18 or newer and Corepack/pnpm available. The exact pnpm version comes from
  `package.json#packageManager` (`pnpm@10.8.1` for this release).
- Git, npm CLI, network access to npm and GitHub, and sufficient temporary disk space.
- An npm account authorized to publish the unscoped `planloft` package, including any
  required 2FA or granular-token policy, plus permission to push `v0.1.0` to GitHub.
- A POSIX-compatible shell on macOS or Linux. The commands use portable Node.js for
  digest calculation and do not require GNU-only command flags.
- A human operator available for the two decision checkpoints and the fresh-host
  visibility checks.

Run **all shell blocks from checkout creation through cleanup in the same shell
session** so `RELEASE_*`, `CANDIDATE_*`, and registry variables persist. Do not copy
only the publish or cleanup block into a fresh shell. Commands use `set -eu`; a failed
`test` or command stops the current sequence and must be investigated before moving on.

## 1. Pin a clean release checkout

From any clean checkout of the repository, fetch `origin/main`, record its exact
commit, and create a detached disposable worktree at that commit:

```bash
set -eu
RELEASE_SOURCE_ROOT="$(git rev-parse --show-toplevel)"
test -z "$(git status --porcelain=v1 --untracked-files=all)"
RELEASE_ORIGIN="$(git remote get-url origin)"
case "$RELEASE_ORIGIN" in
  git@github.com:hatim-s/planloft.git|https://github.com/hatim-s/planloft.git) ;;
  *) echo "Unexpected origin: $RELEASE_ORIGIN" >&2; exit 1 ;;
esac
git fetch origin main
RELEASE_COMMIT="$(git rev-parse origin/main)"
REMOTE_TAG_PRECHECK="$(git ls-remote --tags origin "refs/tags/v0.1.0" "refs/tags/v0.1.0^{}")"
test -z "$REMOTE_TAG_PRECHECK"
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
```

**Expected:** the original checkout is clean, `origin` is the canonical repository,
`git fetch` succeeds, the remote tag lookup is empty, and `git worktree add` reports a
detached checkout. All `test` commands are silent and return zero. Record the
40-character value of
`RELEASE_COMMIT` in the release evidence before continuing.

**Stop if:** the fetch fails, the checkout is dirty, HEAD differs from the recorded
remote commit, `v0.1.0` already exists remotely, or the package version is not `0.1.0`.
A silent `test` followed by a non-zero shell status is a failure, not an empty result.

## 2. Verify tools, npm identity, and version availability

Verify the runtime and install dependencies in the pinned checkout:

```bash
set -eu
node --version
pnpm --version
npm --version
node -e 'const major=Number(process.versions.node.split(".")[0]); if (major < 18) { process.exitCode=1 }'
EXPECTED_PNPM="$(node -p "require('./package.json').packageManager.replace(/^pnpm@/, '')")"
test "$(pnpm --version)" = "$EXPECTED_PNPM"
pnpm install --frozen-lockfile --store-dir "$RELEASE_PNPM_STORE"
```

**Expected:** Node reports `v18` or newer, pnpm prints `10.8.1`, npm prints a version,
and pnpm completes without changing `pnpm-lock.yaml`. The Node and pnpm assertions are
silent on success.

**Stop if:** the Node assertion fails, pnpm differs from the pinned version, dependency
resolution changes the lockfile, or installation fails. Do not regenerate the lockfile
inside the release checkout.

Confirm npm identity, access, and exact-version availability:

```bash
set -eu
NPM_IDENTITY="$(npm whoami)"
printf 'npm identity: %s\n' "$NPM_IDENTITY"
NPM_REGISTRY="$(npm config get registry)"
test "$NPM_REGISTRY" = "https://registry.npmjs.org/"
npm access list packages "$NPM_IDENTITY" --json
if NPM_VERSION_LOOKUP="$(npm view planloft@0.1.0 version 2>&1)"; then
  printf 'Version already exists: %s\n' "$NPM_VERSION_LOOKUP" >&2
  exit 1
else
  case "$NPM_VERSION_LOOKUP" in
    *E404*) printf '%s\n' "Expected: planloft@0.1.0 is not published" ;;
    *) printf '%s\n' "$NPM_VERSION_LOOKUP" >&2; exit 1 ;;
  esac
fi
```

Interpret the output deliberately:

- `npm whoami` must print the intended publishing account. `E401` or `ENEEDAUTH`
  means authentication is missing or expired: stop and repair credentials/2FA policy.
- The registry assertion is silent only for the canonical public npm registry. Stop if
  a project, user, or environment setting points npm at another registry.
- `npm access list packages ... --json` must succeed. If `planloft` already exists, the
  account must have publish-capable access. For a first publication of an available
  unscoped name, absence from the list is normal; confirm ownership/name policy before
  the irreversible checkpoint.
- `npm view planloft@0.1.0 version` should fail with `E404` before the first publish.
  That exact-version `E404` is the expected pre-release state. Output of `0.1.0` means
  the version already exists: stop. `E401`, `E403`, registry/network errors, or an
  unexpected version are not evidence of availability and also stop the release.

Also confirm `package.json`, `planloft --version`, both plugin manifests, both
marketplace npm pins, README recipes, and this runbook consistently say `0.1.0` /
`v0.1.0`. The automated version tests below enforce these repository references.

## 3. Run deterministic release gates

Run the complete local suite from the pinned checkout:

```bash
set -eu
pnpm test
pnpm typecheck
pnpm build
pnpm test:public-api
pnpm test:installer
pnpm test:installer:live
test -z "$(git status --porcelain=v1 --untracked-files=all)"
```

**Expected patterns:**

- `pnpm test` reports 105 source tests and 7 script tests with zero failures.
- `pnpm typecheck` exits zero without TypeScript diagnostics.
- `pnpm build` emits the ESM CLI/library and declarations without errors.
- `pnpm test:public-api` rebuilds and validates root imports and declarations.
- `pnpm test:installer` reports all 96 contract combinations passing.
- `pnpm test:installer:live` reports all 6 pairwise lifecycle cases passing.
- The final clean-worktree assertion is silent.

**Stop if:** any command exits non-zero, counts differ, a gate is skipped, or generated
work leaves the checkout dirty. Treat a changed count as a release-input change that
needs review even when all observed tests pass.

## 4. Create and inspect the one candidate tarball

Create the candidate exactly once. Capture npm's JSON metadata, then validate both the
archive boundary and the executable packed plugin. Keep this tarball unchanged through
post-release verification; do not run `npm pack` again for the release.

```bash
set -eu
PACK_JSON="$(npm pack --json --ignore-scripts --pack-destination "$RELEASE_ARTIFACTS")"
CANDIDATE_FILENAME="$(node -e 'const p=JSON.parse(process.argv[1])[0]; process.stdout.write(p.filename)' "$PACK_JSON")"
CANDIDATE_SHASUM="$(node -e 'const p=JSON.parse(process.argv[1])[0]; process.stdout.write(p.shasum)' "$PACK_JSON")"
CANDIDATE_INTEGRITY="$(node -e 'const p=JSON.parse(process.argv[1])[0]; process.stdout.write(p.integrity)' "$PACK_JSON")"
PACK_ENTRY_COUNT="$(node -e 'const p=JSON.parse(process.argv[1])[0]; process.stdout.write(String(p.files.length))' "$PACK_JSON")"
SKILL_ENTRY_COUNT="$(node -e 'const p=JSON.parse(process.argv[1])[0]; process.stdout.write(String(p.files.filter((f) => f.path === "skills/write-plan/SKILL.md").length))' "$PACK_JSON")"
CANDIDATE_PATH="$RELEASE_ARTIFACTS/$CANDIDATE_FILENAME"
test "$CANDIDATE_FILENAME" = "planloft-0.1.0.tgz"
test -n "$CANDIDATE_SHASUM"
test -n "$CANDIDATE_INTEGRITY"
test "$PACK_ENTRY_COUNT" = "29"
test "$SKILL_ENTRY_COUNT" = "1"
test -f "$CANDIDATE_PATH"
printf 'candidate: %s\nentries: %s\nshasum: %s\nintegrity: %s\n' \
  "$CANDIDATE_FILENAME" "$PACK_ENTRY_COUNT" "$CANDIDATE_SHASUM" "$CANDIDATE_INTEGRITY"
node scripts/validate-packed-plugin.mjs "$CANDIDATE_PATH"
npm publish --dry-run "$CANDIDATE_PATH"
```

**Expected:** npm's JSON object contains `filename`, `shasum`, `integrity`, and `files`;
the candidate is `planloft-0.1.0.tgz`; the archive has exactly 29 entries and exactly
one `skills/write-plan/SKILL.md`; the packed validator reports success for the bridge
and resolver; and the publish dry run reports `planloft@0.1.0` without uploading it.

**Stop if:** JSON parsing fails, a required field is empty, the filename/counts differ,
the validator fails, or the dry-run preview differs from the inspected candidate. The
`PACK_JSON`, candidate path, shasum, and integrity are the release record.

## 5. Revalidate immediately before publication

Fetch again and prove that the candidate, checkout, version, and remote branch still
describe the same release:

```bash
set -eu
git fetch origin main
test -z "$(git status --porcelain=v1 --untracked-files=all)"
test "$(git rev-parse HEAD)" = "$RELEASE_COMMIT"
test "$(git rev-parse origin/main)" = "$RELEASE_COMMIT"
test "$(node -p "require('./package.json').version")" = "0.1.0"
CURRENT_CANDIDATE_SHASUM="$(node -e 'const fs=require("node:fs"),crypto=require("node:crypto"); process.stdout.write(crypto.createHash("sha1").update(fs.readFileSync(process.argv[1])).digest("hex"))' "$CANDIDATE_PATH")"
CURRENT_CANDIDATE_INTEGRITY="sha512-$(node -e 'const fs=require("node:fs"),crypto=require("node:crypto"); process.stdout.write(crypto.createHash("sha512").update(fs.readFileSync(process.argv[1])).digest("base64"))' "$CANDIDATE_PATH")"
test "$CURRENT_CANDIDATE_SHASUM" = "$CANDIDATE_SHASUM"
test "$CURRENT_CANDIDATE_INTEGRITY" = "$CANDIDATE_INTEGRITY"
```

**Expected:** fetch succeeds and every assertion is silent. The current candidate
digests exactly equal the values emitted by the original `npm pack`.

**Stop if:** `origin/main` advanced, the checkout is dirty, HEAD/version changed, the
candidate disappeared, or either digest differs. If main advanced, discard this
candidate and restart from step 1; never publish bytes built from a stale main ref.

### Final external availability checks

Immediately before asking for publication authorization, query both external systems
again. An exact-version `E404` is the only npm result that proves the version remains
available. The remote tag query must succeed and return no matching ref:

```bash
set -eu
if FINAL_NPM_VERSION_LOOKUP="$(npm view planloft@0.1.0 version 2>&1)"; then
  case "$FINAL_NPM_VERSION_LOOKUP" in
    0.1.0) printf '%s\n' "STOP: planloft@0.1.0 already exists" >&2; exit 1 ;;
    *) printf 'STOP: unexpected npm version result: %s\n' "$FINAL_NPM_VERSION_LOOKUP" >&2; exit 1 ;;
  esac
else
  case "$FINAL_NPM_VERSION_LOOKUP" in
    *E404*) printf '%s\n' "Expected: planloft@0.1.0 remains unpublished" ;;
    *E401*|*ENEEDAUTH*) printf '%s\n' "STOP: npm authentication failed" >&2; exit 1 ;;
    *E403*|*EOTP*) printf '%s\n' "STOP: npm authorization or 2FA failed" >&2; exit 1 ;;
    *ENETWORK*|*EAI_AGAIN*|*ECONNRESET*|*ETIMEDOUT*|*E500*|*E502*|*E503*|*E504*) printf '%s\n' "STOP: npm network or registry lookup failed" >&2; exit 1 ;;
    *) printf 'STOP: unexpected npm lookup failure: %s\n' "$FINAL_NPM_VERSION_LOOKUP" >&2; exit 1 ;;
  esac
fi
FINAL_REMOTE_TAG_PRECHECK="$(git ls-remote --tags origin "refs/tags/v0.1.0" "refs/tags/v0.1.0^{}")"
test -z "$FINAL_REMOTE_TAG_PRECHECK"
```

**Expected:** npm prints `Expected: planloft@0.1.0 remains unpublished`, the remote
tag lookup succeeds, and the final tag assertion is silent.

**Stop if:** npm returns the existing version, `E401`/`ENEEDAUTH`, `E403`/`EOTP`, a
network/registry failure, or any unexpected result; or if the remote lookup fails or
finds either tag ref. These checks are a single-use snapshot: after any delay, failed
authorization attempt, or concurrent release signal, rerun this entire block and
return to the decision checkpoint only after it produces the expected result.

### Decision checkpoint: publish to npm

Before continuing, a release-authorized operator must affirm all of the following:

- the recorded commit and retained candidate are the intended `0.1.0` release;
- all deterministic gates and external npm checks passed;
- `planloft@0.1.0` remains unpublished; and
- the operator understands that **npm publication is irreversible: this version cannot
  be overwritten, replaced, or reused**.

The only publication command is:

```bash
set -eu
npm publish --access public "$CANDIDATE_PATH"
```

**Expected:** npm reports `+ planloft@0.1.0` (possibly after an interactive 2FA prompt)
and exits zero. Record the command output and timestamp. `E401`, `E403`, `EOTP`, an
ownership error, a version-conflict response, or an ambiguous network failure is not
success: stop and use the recovery table before doing anything with a tag.

## 6. Verify registry bytes before tagging

Read the published registry metadata and compare both digests with the candidate:

```bash
set -eu
PUBLISHED_METADATA="$(npm view planloft@0.1.0 dist.shasum dist.integrity --json)"
PUBLISHED_SHASUM="$(node -e 'const p=JSON.parse(process.argv[1]); process.stdout.write(p["dist.shasum"])' "$PUBLISHED_METADATA")"
PUBLISHED_INTEGRITY="$(node -e 'const p=JSON.parse(process.argv[1]); process.stdout.write(p["dist.integrity"])' "$PUBLISHED_METADATA")"
test "$PUBLISHED_SHASUM" = "$CANDIDATE_SHASUM"
test "$PUBLISHED_INTEGRITY" = "$CANDIDATE_INTEGRITY"
```

**Expected:** registry JSON contains `dist.shasum` and `dist.integrity`; both equality
checks are silent.

**Stop if:** metadata is temporarily missing or either value is empty/different.
Registry propagation can lag after a successful publish; wait and repeat only the
read-only `npm view` and comparison commands. Never repack or republish to address
propagation. A persistent digest mismatch is an incident and prohibits tagging.

### Decision checkpoint: create and push the tag

Proceed only after a release-authorized operator confirms registry digest equality.
The tag **must not be created or pushed before both registry digests equal the retained
candidate**, and a public tag must never be force-moved.

```bash
set -eu
REMOTE_TAG_PRECHECK="$(git ls-remote --tags origin "refs/tags/v0.1.0" "refs/tags/v0.1.0^{}")"
test -z "$REMOTE_TAG_PRECHECK"
git tag -a v0.1.0 "$RELEASE_COMMIT" -m "planloft v0.1.0"
test "$(git rev-parse 'v0.1.0^{}')" = "$RELEASE_COMMIT"
git push origin "refs/tags/v0.1.0:refs/tags/v0.1.0"
REMOTE_TAG_OBJECT="$(git ls-remote --exit-code origin "refs/tags/v0.1.0" | awk '{print $1}')"
REMOTE_TAG_COMMIT="$(git ls-remote --exit-code origin "refs/tags/v0.1.0^{}" | awk '{print $1}')"
test -n "$REMOTE_TAG_OBJECT"
test "$REMOTE_TAG_COMMIT" = "$RELEASE_COMMIT"
```

**Expected:** the precheck and local dereference assertion are silent, the push reports
a new tag, and the remote object is non-empty while its dereferenced commit equals
`RELEASE_COMMIT`. Record both remote values.

**Stop if:** the tag already exists unexpectedly, its dereferenced commit differs, the
push fails, or the remote ref cannot be read. Do not use force, delete a public tag, or
retarget it. Diagnose permissions/network state and retry only the exact tag push when
the existing local tag is verified correct and the remote tag is still absent.

## 7. Validate released installation surfaces

After npm and GitHub both expose the release, exercise all source variants:

```bash
set -eu
PLANLOFT_RELEASE_TAG=v0.1.0 pnpm test:installer:release
```

**Expected:** all 96 source/package-manager/agent/scope/method/CLI-state combinations
pass, including byte-for-byte comparison of the tagged skill. Any failure stops release
announcement and is recorded as a post-publication incident; published npm bytes and a
public tag are not rewritten to repair an installer issue.

Then start fresh Codex and Claude Code sessions and manually verify:

- the tagged `write-plan` skill is visible in each agent;
- Codex and Claude marketplace catalogs resolve npm `planloft@0.1.0`;
- a full-plugin install exposes exactly one skill and its bundled bridge reports
  `0.1.0`;
- skill-only installs do not add hooks or a global CLI; and
- removal and reinstall leave no stale retired skills or aliases.

**Expected:** every assertion holds in genuinely fresh host sessions. Agent/plugin
visibility is manual because neither host has a stable cross-host, noninteractive
discovery command. Host visibility failure stops announcement but does not justify
altering the published package or force-moving the tag.

## 8. Record evidence and clean up

Complete this record in the release issue, change log, or other durable maintainer log:

```text
Planloft release evidence
Version: 0.1.0
Tag: v0.1.0
RELEASE_COMMIT: <40-character commit>
Candidate filename: planloft-0.1.0.tgz
Candidate shasum: <CANDIDATE_SHASUM>
Candidate integrity: <CANDIDATE_INTEGRITY>
Registry shasum: <PUBLISHED_SHASUM>
Registry integrity: <PUBLISHED_INTEGRITY>
Remote tag object: <REMOTE_TAG_OBJECT>
Remote tag dereferenced commit: <REMOTE_TAG_COMMIT, equal to RELEASE_COMMIT>
Tests: 105 source; 7 script; typecheck/build/public API passed
Installer tests: 96 contract; 6 live pairwise; 96 source-all passed
Manual host checks: Codex <pass/fail>; Claude Code <pass/fail>
Published at: <ISO-8601 timestamp>
Operator: <name or handle>
Notes/incidents: <none or links>
```

Keep the candidate until the source-all gate, fresh-session checks, and evidence record
are complete. Then return to the original checkout and remove only the validated
disposable release directory:

```bash
set -eu
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

**Expected:** all safety assertions are silent, Git removes only the detached release
worktree, and only the validated `planloft-release.*` temporary directory is deleted.

**Stop if:** any path variable is empty, the path pattern or exact checkout assertion
fails, or Git reports the worktree as modified. Never broaden the removal path, use an
unresolved variable as a deletion target, or force-remove a worktree containing changes.

## Failure and recovery guide

| Failure | Required response | Resume point |
| --- | --- | --- |
| npm authentication, 2FA, or ownership failure | Stop; repair account/token policy and confirm the intended identity and publish access. Do not weaken registry security settings. | Repeat step 2 and every later gate. |
| `planloft@0.1.0` already exists | Stop. Inspect provenance and digests. If this is the same interrupted release and both digests equal the retained candidate, resume registry/tag verification; otherwise never overwrite it and prepare a new reviewed version. | Step 6 only for a proven matching interrupted release; otherwise a new candidate at step 1. |
| `v0.1.0` already exists | Stop and inspect its annotated object and dereferenced commit. Never delete, overwrite, or force-move a public tag. If it is the already completed matching release, verify step 7 rather than publishing again. | Step 7 only for a proven matching completed release; otherwise incident response. |
| `origin/main` advances before publication | Stop and retain evidence only for diagnosis. Discard the stale candidate after safely removing its disposable worktree; never publish it. | Step 1 at the new main commit. |
| A concurrent release appears during the final external checks | Stop. Do not publish or create a tag. Inspect the exact npm version and both remote tag refs. If the registry bytes and tag prove this same release completed elsewhere, continue at step 7; otherwise treat the collision as an incident and prepare a new reviewed version. | Step 7 only for a proven matching completed release; otherwise incident response or a new candidate at step 1. |
| Test count, typecheck, build, package entry, or dry-run mismatch | Stop and fix through the normal reviewed development flow. Do not patch files in the detached release checkout. | Step 1 after the fix is merged. |
| Publish result is ambiguous because the connection failed | Do not blindly retry. Query the exact version and its registry digests. If present, follow step 6; if absent, reconfirm with npm before returning to the publish checkpoint. | Step 6 when present, or the publish checkpoint only after absence is certain. |
| Publish reports success but registry metadata is delayed | Do not publish again. Wait for propagation, then repeat the read-only `npm view` and digest comparisons. | Step 6. |
| Published registry digest differs from candidate | Stop announcement and tagging; preserve candidate, output, and metadata as incident evidence. Never republish or overwrite the version. | Incident response; no tag until provenance is resolved. |
| Tag creation or push fails | If the local tag correctly dereferences to `RELEASE_COMMIT` and the remote tag is absent, repair auth/network and retry the exact non-force push. If any public tag exists at another commit, stop and escalate. | Tag checkpoint in step 6; never force-move or delete a public tag. |
| Source-all installer or host visibility fails | Stop announcement, capture the failing case/session, and fix forward with a new reviewed version if code changes are required. Do not mutate `0.1.0` or move `v0.1.0`. | Repeat step 7 for diagnosis; release a new version for fixes. |

The package and tag are independent external gates. The release is complete only when
the registry digests match, the tag resolves to `RELEASE_COMMIT`, the source-all matrix
passes, fresh hosts see the skill, and the evidence record is stored.
