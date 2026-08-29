#!/usr/bin/env bash

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PACKAGE_NAME="$(node -p 'require("./package.json").name')"
VERSION="$(node -p 'require("./package.json").version')"
TAG="v$VERSION"
RELEASE_DIR="$ROOT/.release"
CANDIDATE="$RELEASE_DIR/$PACKAGE_NAME-$VERSION.tgz"
COMMIT_FILE="$CANDIDATE.commit"
NPM_VIEW_OUTPUT=""

fail() {
  printf 'release: %s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "missing required command: $1"
}

npm_version_exists() {
  local status

  set +e
  NPM_VIEW_OUTPUT="$(npm view "$PACKAGE_NAME@$VERSION" version --json 2>&1)"
  status=$?
  set -e

  if [[ $status -eq 0 ]]; then
    return 0
  fi
  if [[ "$NPM_VIEW_OUTPUT" == *"E404"* ]]; then
    return 1
  fi

  printf '%s\n' "$NPM_VIEW_OUTPUT" >&2
  fail "could not determine whether $PACKAGE_NAME@$VERSION exists on npm"
}

remote_tag_commit() {
  local refs peeled direct

  refs="$(git ls-remote origin "refs/tags/$TAG" "refs/tags/$TAG^{}")"
  [[ -n "$refs" ]] || return 1

  peeled="$(printf '%s\n' "$refs" | awk '$2 ~ /\^\{\}$/ { print $1; exit }')"
  direct="$(printf '%s\n' "$refs" | awk '$2 !~ /\^\{\}$/ { print $1; exit }')"
  printf '%s\n' "${peeled:-$direct}"
}

preflight_checkout() {
  local branch dirty head remote_head node_major

  for command in git node npm pnpm bun bunx tar shasum; do
    require_command "$command"
  done

  node_major="$(node -p 'Number(process.versions.node.split(".")[0])')"
  (( node_major >= 18 )) || fail "Node.js 18 or newer is required"

  git fetch origin main --tags
  branch="$(git branch --show-current)"
  [[ "$branch" == "main" ]] || fail "run the release from main, not $branch"

  dirty="$(git status --porcelain --untracked-files=all)"
  [[ -z "$dirty" ]] || {
    printf '%s\n' "$dirty" >&2
    fail "the checkout is not clean"
  }

  head="$(git rev-parse HEAD)"
  remote_head="$(git rev-parse origin/main)"
  [[ "$head" == "$remote_head" ]] || fail "main is not at origin/main"
  [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail "package version is not stable semver: $VERSION"
}

require_unpublished_destinations() {
  local tag_commit

  if npm_version_exists; then
    fail "$PACKAGE_NAME@$VERSION already exists on npm"
  fi

  if git rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then
    fail "local tag $TAG already exists"
  fi

  if tag_commit="$(remote_tag_commit)"; then
    fail "remote tag $TAG already exists at $tag_commit"
  fi
}

prepare_release() {
  local release_commit candidate_sha1

  preflight_checkout
  require_unpublished_destinations

  bun install --frozen-lockfile
  bun run test
  bun run typecheck
  bun run test:public-api
  bun run test:installer
  bun run test:installer:live

  mkdir -p "$RELEASE_DIR"
  rm -f "$CANDIDATE" "$COMMIT_FILE"
  npm pack --pack-destination "$RELEASE_DIR"
  [[ -f "$CANDIDATE" ]] || fail "npm pack did not create $CANDIDATE"

  tar -tf "$CANDIDATE" | sort
  node scripts/validate-packed-package.mjs "$CANDIDATE"
  npm publish --dry-run --access public "$CANDIDATE"

  release_commit="$(git rev-parse HEAD)"
  candidate_sha1="$(shasum "$CANDIDATE" | awk '{ print $1 }')"
  printf '%s\n' "$release_commit" > "$COMMIT_FILE"

  printf '\nPrepared %s@%s\n' "$PACKAGE_NAME" "$VERSION"
  printf '  commit:   %s\n' "$release_commit"
  printf '  candidate: %s\n' "$CANDIDATE"
  printf '  sha1:      %s\n' "$candidate_sha1"
  printf '\nPublish with:\n  PLANLOFT_PUBLISH=1 bun run release:publish\n'
}

wait_for_published_version() {
  local attempt

  for attempt in {1..12}; do
    if npm_version_exists; then
      return 0
    fi
    sleep 5
  done

  fail "$PACKAGE_NAME@$VERSION is not visible on npm after 60 seconds; check npm before rerunning"
}

verify_published_candidate() {
  local candidate_sha1 registry_sha1 published_version

  [[ -f "$CANDIDATE" ]] || fail "missing prepared candidate: $CANDIDATE"
  [[ -f "$COMMIT_FILE" ]] || fail "missing prepared commit record: $COMMIT_FILE"
  [[ "$(cat "$COMMIT_FILE")" == "$(git rev-parse HEAD)" ]] || fail "the candidate was prepared from a different commit"

  candidate_sha1="$(shasum "$CANDIDATE" | awk '{ print $1 }')"
  registry_sha1="$(npm view "$PACKAGE_NAME@$VERSION" dist.shasum)"
  [[ "$candidate_sha1" == "$registry_sha1" ]] || fail "the npm tarball does not match the prepared candidate"

  published_version="$(npm view "$PACKAGE_NAME@$VERSION" version)"
  [[ "$published_version" == "$VERSION" ]] || fail "npm returned unexpected version $published_version"
}

publish_release() {
  local release_commit tag_commit

  [[ "${PLANLOFT_PUBLISH:-}" == "1" ]] || fail "set PLANLOFT_PUBLISH=1 to allow npm publication and tag creation"

  preflight_checkout
  npm whoami >/dev/null || fail "run npm login before publishing"

  if npm_version_exists; then
    printf '%s@%s already exists; verifying the prepared tarball before resuming.\n' "$PACKAGE_NAME" "$VERSION"
  else
    prepare_release
    preflight_checkout
    npm publish --access public "$CANDIDATE"
    wait_for_published_version
  fi

  verify_published_candidate
  release_commit="$(cat "$COMMIT_FILE")"

  if tag_commit="$(remote_tag_commit)"; then
    [[ "$tag_commit" == "$release_commit" ]] || fail "remote tag $TAG points to $tag_commit, not $release_commit"
    printf 'Remote tag %s already points to the release commit.\n' "$TAG"
  else
    if git rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then
      tag_commit="$(git rev-list -n 1 "$TAG")"
      [[ "$tag_commit" == "$release_commit" ]] || fail "local tag $TAG points to $tag_commit, not $release_commit"
    else
      git tag -a "$TAG" "$release_commit" -m "$PACKAGE_NAME $TAG"
    fi
    git push origin "$TAG"
    tag_commit="$(remote_tag_commit)"
    [[ "$tag_commit" == "$release_commit" ]] || fail "remote tag verification failed"
  fi

  PLANLOFT_RELEASE_TAG="$TAG" bun run test:installer:release
  npm view "$PACKAGE_NAME@$VERSION" version dist.shasum dist.integrity

  printf '\nPublished %s@%s and tagged %s at %s.\n' "$PACKAGE_NAME" "$VERSION" "$TAG" "$release_commit"
}

usage() {
  cat <<'EOF'
Usage: bash scripts/release.sh <prepare|publish>

  prepare  Run all release gates and build .release/planloft-<version>.tgz.
  publish  Publish that exact tarball, create the matching tag, and run release UAT.

Publishing requires npm authentication and PLANLOFT_PUBLISH=1.
EOF
}

case "${1:-}" in
  prepare)
    prepare_release
    ;;
  publish)
    publish_release
    ;;
  -h|--help|help)
    usage
    ;;
  *)
    usage >&2
    exit 2
    ;;
esac
