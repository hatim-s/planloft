import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { createProgram } from "./program.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (file: string) => fs.readFileSync(path.join(ROOT, file), "utf8");
const readJson = (file: string) => JSON.parse(read(file)) as Record<string, unknown>;
const EXPECTED_RELEASE_VERSION = "0.1.0";
const EXPECTED_RELEASE_TAG = "v0.1.0";

const AUTHORITATIVE_RELEASE_FILES = [
  "package.json",
  "README.md",
  "docs/README.md",
  "docs/releasing.md",
  ".codex-plugin/plugin.json",
  ".agents/plugins/marketplace.json",
  ".claude-plugin/plugin.json",
  ".claude-plugin/marketplace.json",
] as const;

test("package, source CLI, plugin manifests, and marketplace npm pins match the literal release", () => {
  const packageJson = readJson("package.json");
  const codexPlugin = readJson(".codex-plugin/plugin.json");
  const claudePlugin = readJson(".claude-plugin/plugin.json");
  const codexMarketplace = readJson(".agents/plugins/marketplace.json") as {
    plugins: Array<{ source: { package: string; version: string } }>;
  };
  const claudeMarketplace = readJson(".claude-plugin/marketplace.json") as {
    plugins: Array<{ version: string; source: { package: string; version: string } }>;
  };

  assert.equal(packageJson.version, EXPECTED_RELEASE_VERSION);
  assert.equal(createProgram().version(), EXPECTED_RELEASE_VERSION);
  assert.equal(codexPlugin.version, EXPECTED_RELEASE_VERSION);
  assert.equal(claudePlugin.version, EXPECTED_RELEASE_VERSION);
  assert.equal(codexMarketplace.plugins.length, 1);
  assert.equal(codexMarketplace.plugins[0]!.source.package, "planloft");
  assert.equal(codexMarketplace.plugins[0]!.source.version, EXPECTED_RELEASE_VERSION);
  assert.equal(claudeMarketplace.plugins[0]!.source.package, "planloft");
  assert.equal(claudeMarketplace.plugins[0]!.source.version, EXPECTED_RELEASE_VERSION);
  assert.equal(claudeMarketplace.plugins[0]!.version, EXPECTED_RELEASE_VERSION);
});

test("release-facing documentation pins the prepared npm version and matching tag", () => {
  const readme = read("README.md");
  const releaseGuide = read("docs/releasing.md");
  const docsReadme = read("docs/README.md");

  assert.ok(readme.includes(`planloft@${EXPECTED_RELEASE_VERSION}`));
  assert.ok(readme.includes(`/tree/${EXPECTED_RELEASE_TAG}/skills/write-plan`));
  assert.ok(readme.includes(`--ref ${EXPECTED_RELEASE_TAG}`));
  assert.ok(readme.includes(`.git#${EXPECTED_RELEASE_TAG}`));
  assert.ok(docsReadme.includes(`PLANLOFT_RELEASE_TAG=${EXPECTED_RELEASE_TAG}`));
  assert.ok(docsReadme.includes(`planloft-${EXPECTED_RELEASE_VERSION}.tgz`));
  assert.ok(releaseGuide.includes(`npm view planloft@${EXPECTED_RELEASE_VERSION} version`));
  assert.ok(releaseGuide.includes(`git tag -a ${EXPECTED_RELEASE_TAG}`));
  assert.ok(releaseGuide.includes(`PLANLOFT_RELEASE_TAG=${EXPECTED_RELEASE_TAG}`));

  const priorVersion = ["0", "0", "1"].join(".");
  for (const stale of [priorVersion, `v${priorVersion}`]) {
    for (const file of AUTHORITATIVE_RELEASE_FILES) {
      assert.ok(!read(file).includes(stale), `${file} contains stale release version ${stale}`);
    }
  }

  const releaseReferences = [
    /planloft@(\d+\.\d+\.\d+)/g,
    /planloft-(\d+\.\d+\.\d+)\.tgz/g,
    /(?:\/tree\/|--ref\s+|\.git#|PLANLOFT_RELEASE_TAG=)(v\d+\.\d+\.\d+)/g,
    /Release Planloft (\d+\.\d+\.\d+)/g,
    /(?:matching|repository) [`']?(v\d+\.\d+\.\d+)[`']?/g,
    /reports\s+[`']?(\d+\.\d+\.\d+)[`']?/g,
  ];
  for (const file of AUTHORITATIVE_RELEASE_FILES) {
    const contents = read(file);
    for (const pattern of releaseReferences) {
      for (const match of contents.matchAll(pattern)) {
        const actual = match[1]!;
        const expected = actual.startsWith("v")
          ? EXPECTED_RELEASE_TAG
          : EXPECTED_RELEASE_VERSION;
        assert.equal(actual, expected, `${file} contains unexpected release reference ${actual}`);
      }
    }
  }
});

test("release runbook pins one candidate from origin/main through publish, digest verification, and tag", () => {
  const guide = read("docs/releasing.md");

  for (const required of [
    "git fetch origin main",
    'RELEASE_COMMIT="$(git rev-parse origin/main)"',
    'git worktree add --detach "$RELEASE_CHECKOUT" "$RELEASE_COMMIT"',
    'pnpm install --frozen-lockfile --store-dir "$RELEASE_PNPM_STORE"',
    'PACK_JSON="$(npm pack --json --ignore-scripts --pack-destination "$RELEASE_ARTIFACTS")"',
    'npm publish --dry-run "$CANDIDATE_PATH"',
    'npm publish --access public "$CANDIDATE_PATH"',
    'test "$(git rev-parse origin/main)" = "$RELEASE_COMMIT"',
    'test "$CURRENT_CANDIDATE_SHASUM" = "$CANDIDATE_SHASUM"',
    'test "$CURRENT_CANDIDATE_INTEGRITY" = "$CANDIDATE_INTEGRITY"',
    'test "$PUBLISHED_SHASUM" = "$CANDIDATE_SHASUM"',
    'test "$PUBLISHED_INTEGRITY" = "$CANDIDATE_INTEGRITY"',
    `git tag -a ${EXPECTED_RELEASE_TAG} "$RELEASE_COMMIT"`,
    `git push origin "refs/tags/${EXPECTED_RELEASE_TAG}:refs/tags/${EXPECTED_RELEASE_TAG}"`,
    `PLANLOFT_RELEASE_TAG=${EXPECTED_RELEASE_TAG} pnpm test:installer:release`,
  ]) {
    assert.ok(guide.includes(required), `release runbook is missing: ${required}`);
  }

  assert.ok(
    guide.indexOf('npm publish --access public "$CANDIDATE_PATH"') <
      guide.indexOf(`git tag -a ${EXPECTED_RELEASE_TAG} "$RELEASE_COMMIT"`),
    "candidate must be published before the release tag is created",
  );
  assert.ok(
    guide.indexOf('test "$PUBLISHED_INTEGRITY" = "$CANDIDATE_INTEGRITY"') <
      guide.indexOf(`git tag -a ${EXPECTED_RELEASE_TAG} "$RELEASE_COMMIT"`),
    "registry integrity must be verified before the release tag is created",
  );
});

test("release runbook documents operator gates, recovery, evidence, and safe ordering", () => {
  const guide = read("docs/releasing.md");
  const docsReadme = read("docs/README.md");

  for (const heading of [
    "## Release-state overview",
    "## Prerequisites and operating assumptions",
    "## 1. Pin a clean release checkout",
    "## 2. Verify tools, npm identity, and version availability",
    "## 3. Run deterministic release gates",
    "## 4. Create and inspect the one candidate tarball",
    "## 5. Revalidate immediately before publication",
    "### Decision checkpoint: publish to npm",
    "## 6. Verify registry bytes before tagging",
    "### Decision checkpoint: create and push the tag",
    "## 7. Validate released installation surfaces",
    "## 8. Record evidence and clean up",
    "## Failure and recovery guide",
  ]) {
    assert.ok(guide.includes(heading), `release runbook is missing heading: ${heading}`);
  }

  for (const boundary of [
    "all shell blocks from checkout creation through cleanup in the same shell",
    "npm publication is irreversible",
    "must not be created or pushed before both registry digests equal",
    "public tag must never be force-moved",
    "**Expected:**",
    "**Stop if:**",
  ]) {
    assert.ok(guide.includes(boundary), `release runbook is missing safety boundary: ${boundary}`);
  }
  assert.match(guide, /cannot\s+be overwritten, replaced, or reused/);
  assert.ok((guide.match(/\*\*Expected(?: patterns)?:\*\*/g) ?? []).length >= 8);
  assert.ok((guide.match(/\*\*Stop if:\*\*/g) ?? []).length >= 8);

  for (const expected of [
    "105 source tests and 7 script tests",
    "all 96 contract combinations passing",
    "all 6 pairwise lifecycle cases passing",
    'test "$PACK_ENTRY_COUNT" = "29"',
    'test "$SKILL_ENTRY_COUNT" = "1"',
    "*E404*)",
    "E401",
    'test "$REMOTE_TAG_COMMIT" = "$RELEASE_COMMIT"',
  ]) {
    assert.ok(guide.includes(expected), `release expected-output contract is missing: ${expected}`);
  }

  for (const evidence of [
    "RELEASE_COMMIT: <40-character commit>",
    "Candidate filename: planloft-0.1.0.tgz",
    "Candidate shasum: <CANDIDATE_SHASUM>",
    "Candidate integrity: <CANDIDATE_INTEGRITY>",
    "Registry shasum: <PUBLISHED_SHASUM>",
    "Registry integrity: <PUBLISHED_INTEGRITY>",
    "Remote tag object: <REMOTE_TAG_OBJECT>",
    "Remote tag dereferenced commit: <REMOTE_TAG_COMMIT, equal to RELEASE_COMMIT>",
    "Published at: <ISO-8601 timestamp>",
    "Operator: <name or handle>",
  ]) {
    assert.ok(guide.includes(evidence), `release evidence template is missing: ${evidence}`);
  }

  for (const recovery of [
    "npm authentication, 2FA, or ownership failure",
    "`planloft@0.1.0` already exists",
    "`v0.1.0` already exists",
    "`origin/main` advances before publication",
    "Publish result is ambiguous because the connection failed",
    "Publish reports success but registry metadata is delayed",
    "Published registry digest differs from candidate",
    "Tag creation or push fails",
    "Source-all installer or host visibility fails",
  ]) {
    assert.ok(guide.includes(recovery), `release recovery table is missing: ${recovery}`);
  }

  const order = [
    "pnpm test",
    'PACK_JSON="$(npm pack --json --ignore-scripts --pack-destination "$RELEASE_ARTIFACTS")"',
    'npm publish --dry-run "$CANDIDATE_PATH"',
    "### Decision checkpoint: publish to npm",
    'npm publish --access public "$CANDIDATE_PATH"',
    'test "$PUBLISHED_INTEGRITY" = "$CANDIDATE_INTEGRITY"',
    "### Decision checkpoint: create and push the tag",
    `git tag -a ${EXPECTED_RELEASE_TAG} "$RELEASE_COMMIT"`,
    `PLANLOFT_RELEASE_TAG=${EXPECTED_RELEASE_TAG} pnpm test:installer:release`,
    'git worktree remove "$RELEASE_CHECKOUT"',
  ];
  for (let index = 1; index < order.length; index += 1) {
    assert.ok(
      guide.indexOf(order[index - 1]!) < guide.indexOf(order[index]!),
      `release operation is out of order: ${order[index - 1]} before ${order[index]}`,
    );
  }

  assert.ok(docsReadme.includes("[operator release\nrunbook](./releasing.md)"));
});
