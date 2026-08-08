import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { createProgram } from "./program.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (file: string) => fs.readFileSync(path.join(ROOT, file), "utf8");
const readJson = (file: string) => JSON.parse(read(file)) as Record<string, unknown>;
const EXPECTED_RELEASE_VERSION = "0.1.0";
const EXPECTED_RELEASE_TAG = "v0.1.0";

type MarkdownHeading = {
  level: number;
  text: string;
  line: number;
};

type BashBlock = {
  heading: string | undefined;
  startLine: number;
  code: string;
  lines: string[];
};

function parseExecutableMarkdown(markdown: string): {
  headings: MarkdownHeading[];
  bashBlocks: BashBlock[];
} {
  const lines = markdown.split(/\r?\n/);
  const headings: MarkdownHeading[] = [];
  const bashBlocks: BashBlock[] = [];
  let currentHeading: string | undefined;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const heading = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (heading) {
      currentHeading = heading[2]!;
      headings.push({ level: heading[1]!.length, text: currentHeading, line: index + 1 });
      continue;
    }

    const fence = /^```([^`]*)$/.exec(line);
    if (!fence) continue;

    const info = fence[1]!.trim().split(/\s+/, 1)[0];
    const blockStart = index + 2;
    const blockLines: string[] = [];
    index += 1;
    while (index < lines.length && lines[index] !== "```") {
      blockLines.push(lines[index]!);
      index += 1;
    }
    assert.ok(index < lines.length, `unterminated Markdown fence starting at line ${blockStart - 1}`);

    if (info === "bash") {
      bashBlocks.push({
        heading: currentHeading,
        startLine: blockStart,
        code: blockLines.join("\n"),
        lines: blockLines,
      });
    }
  }

  return { headings, bashBlocks };
}

function executableLineLocations(blocks: BashBlock[], command: string): number[] {
  const locations: number[] = [];
  for (const block of blocks) {
    block.lines.forEach((line, index) => {
      if (line === command) locations.push(block.startLine + index);
    });
  }
  return locations;
}

function uniqueExecutableLine(blocks: BashBlock[], command: string): number {
  const locations = executableLineLocations(blocks, command);
  assert.equal(locations.length, 1, `expected one executable line, found ${locations.length}: ${command}`);
  return locations[0]!;
}

function uniqueCommandBlock(blocks: BashBlock[], markers: string[]): BashBlock {
  const matches = blocks.filter((block) =>
    markers.every((marker) => block.lines.some((line) => line === marker)),
  );
  assert.equal(matches.length, 1, `expected one Bash block containing: ${markers.join(" | ")}`);
  return matches[0]!;
}

function uniqueHeadingLine(headings: MarkdownHeading[], text: string): number {
  const matches = headings.filter((heading) => heading.text === text);
  assert.equal(matches.length, 1, `expected one Markdown heading: ${text}`);
  return matches[0]!.line;
}

function assertReleaseExecutableSafety(markdown: string): void {
  const { headings, bashBlocks } = parseExecutableMarkdown(markdown);
  const expectedGroups = [
    [
      'RELEASE_SOURCE_ROOT="$(git rev-parse --show-toplevel)"',
      'RELEASE_COMMIT="$(git rev-parse origin/main)"',
      'git worktree add --detach "$RELEASE_CHECKOUT" "$RELEASE_COMMIT"',
    ],
    [
      "node --version",
      'EXPECTED_PNPM="$(node -p "require(\'./package.json\').packageManager.replace(/^pnpm@/, \'\')")"',
      'pnpm install --frozen-lockfile --store-dir "$RELEASE_PNPM_STORE"',
    ],
    ['NPM_IDENTITY="$(npm whoami)"', 'NPM_REGISTRY="$(npm config get registry)"'],
    ["pnpm test", "pnpm typecheck", "pnpm build", "pnpm test:installer:live"],
    [
      'PACK_JSON="$(npm pack --json --ignore-scripts --pack-destination "$RELEASE_ARTIFACTS")"',
      'npm publish --dry-run "$CANDIDATE_PATH"',
    ],
    [
      'test "$(git rev-parse origin/main)" = "$RELEASE_COMMIT"',
      'CURRENT_CANDIDATE_SHASUM="$(node -e \'const fs=require("node:fs"),crypto=require("node:crypto"); process.stdout.write(crypto.createHash("sha1").update(fs.readFileSync(process.argv[1])).digest("hex"))\' "$CANDIDATE_PATH")"',
      'test "$CURRENT_CANDIDATE_INTEGRITY" = "$CANDIDATE_INTEGRITY"',
    ],
    [
      'if FINAL_NPM_VERSION_LOOKUP="$(npm view planloft@0.1.0 version 2>&1)"; then',
      '    0.1.0) printf \'%s\\n\' "STOP: planloft@0.1.0 already exists" >&2; exit 1 ;;',
      '    *E404*) printf \'%s\\n\' "Expected: planloft@0.1.0 remains unpublished" ;;',
      '    *E401*|*ENEEDAUTH*) printf \'%s\\n\' "STOP: npm authentication failed" >&2; exit 1 ;;',
      '    *E403*|*EOTP*) printf \'%s\\n\' "STOP: npm authorization or 2FA failed" >&2; exit 1 ;;',
      '    *ENETWORK*|*EAI_AGAIN*|*ECONNRESET*|*ETIMEDOUT*|*E500*|*E502*|*E503*|*E504*) printf \'%s\\n\' "STOP: npm network or registry lookup failed" >&2; exit 1 ;;',
      'FINAL_REMOTE_TAG_PRECHECK="$(git ls-remote --tags origin "refs/tags/v0.1.0" "refs/tags/v0.1.0^{}")"',
      'test -z "$FINAL_REMOTE_TAG_PRECHECK"',
    ],
    ['npm publish --access public "$CANDIDATE_PATH"'],
    [
      'PUBLISHED_METADATA="$(npm view planloft@0.1.0 dist.shasum dist.integrity --json)"',
      'test "$PUBLISHED_INTEGRITY" = "$CANDIDATE_INTEGRITY"',
    ],
    [
      `git tag -a ${EXPECTED_RELEASE_TAG} "$RELEASE_COMMIT" -m "planloft ${EXPECTED_RELEASE_TAG}"`,
      `git push origin "refs/tags/${EXPECTED_RELEASE_TAG}:refs/tags/${EXPECTED_RELEASE_TAG}"`,
      'test "$REMOTE_TAG_COMMIT" = "$RELEASE_COMMIT"',
    ],
    [`PLANLOFT_RELEASE_TAG=${EXPECTED_RELEASE_TAG} pnpm test:installer:release`],
    ['git worktree remove "$RELEASE_CHECKOUT"', 'rm -rf -- "$RELEASE_ROOT"'],
  ];

  assert.equal(bashBlocks.length, expectedGroups.length, "release runbook has an unexpected Bash block");
  for (const markers of expectedGroups) uniqueCommandBlock(bashBlocks, markers);
  for (const block of bashBlocks) {
    assert.equal(block.lines.find((line) => line.trim() !== ""), "set -eu", `Bash block under ${block.heading} is not fail-fast`);
  }

  const orderedCommands = [
    'git worktree add --detach "$RELEASE_CHECKOUT" "$RELEASE_COMMIT"',
    'pnpm install --frozen-lockfile --store-dir "$RELEASE_PNPM_STORE"',
    "pnpm test",
    'PACK_JSON="$(npm pack --json --ignore-scripts --pack-destination "$RELEASE_ARTIFACTS")"',
    'npm publish --dry-run "$CANDIDATE_PATH"',
    'test "$CURRENT_CANDIDATE_INTEGRITY" = "$CANDIDATE_INTEGRITY"',
    'if FINAL_NPM_VERSION_LOOKUP="$(npm view planloft@0.1.0 version 2>&1)"; then',
    'test -z "$FINAL_REMOTE_TAG_PRECHECK"',
    'npm publish --access public "$CANDIDATE_PATH"',
    'PUBLISHED_METADATA="$(npm view planloft@0.1.0 dist.shasum dist.integrity --json)"',
    'test "$PUBLISHED_INTEGRITY" = "$CANDIDATE_INTEGRITY"',
    `git tag -a ${EXPECTED_RELEASE_TAG} "$RELEASE_COMMIT" -m "planloft ${EXPECTED_RELEASE_TAG}"`,
    `git push origin "refs/tags/${EXPECTED_RELEASE_TAG}:refs/tags/${EXPECTED_RELEASE_TAG}"`,
    `PLANLOFT_RELEASE_TAG=${EXPECTED_RELEASE_TAG} pnpm test:installer:release`,
    'git worktree remove "$RELEASE_CHECKOUT"',
    'rm -rf -- "$RELEASE_ROOT"',
  ].map((command) => uniqueExecutableLine(bashBlocks, command));
  for (let index = 1; index < orderedCommands.length; index += 1) {
    assert.ok(orderedCommands[index - 1]! < orderedCommands[index]!, "release command groups are out of order");
  }

  const finalNpmCheck = uniqueExecutableLine(
    bashBlocks,
    'if FINAL_NPM_VERSION_LOOKUP="$(npm view planloft@0.1.0 version 2>&1)"; then',
  );
  const finalRemoteCheck = uniqueExecutableLine(
    bashBlocks,
    'FINAL_REMOTE_TAG_PRECHECK="$(git ls-remote --tags origin "refs/tags/v0.1.0" "refs/tags/v0.1.0^{}")"',
  );
  const finalRemoteAbsence = uniqueExecutableLine(bashBlocks, 'test -z "$FINAL_REMOTE_TAG_PRECHECK"');
  const publishDecision = uniqueHeadingLine(headings, "Decision checkpoint: publish to npm");
  const publish = uniqueExecutableLine(bashBlocks, 'npm publish --access public "$CANDIDATE_PATH"');
  assert.ok(finalNpmCheck < finalRemoteCheck && finalRemoteCheck < finalRemoteAbsence);
  assert.ok(finalRemoteAbsence < publishDecision && publishDecision < publish);

  const candidateShasum = uniqueExecutableLine(
    bashBlocks,
    'test "$CURRENT_CANDIDATE_SHASUM" = "$CANDIDATE_SHASUM"',
  );
  const candidateIntegrity = uniqueExecutableLine(
    bashBlocks,
    'test "$CURRENT_CANDIDATE_INTEGRITY" = "$CANDIDATE_INTEGRITY"',
  );
  assert.ok(candidateShasum < publish && candidateIntegrity < publish, "candidate digest checks must precede publish");

  const registryShasum = uniqueExecutableLine(
    bashBlocks,
    'test "$PUBLISHED_SHASUM" = "$CANDIDATE_SHASUM"',
  );
  const registryIntegrity = uniqueExecutableLine(
    bashBlocks,
    'test "$PUBLISHED_INTEGRITY" = "$CANDIDATE_INTEGRITY"',
  );
  const tagCommands = bashBlocks.flatMap((block) => block.lines.filter((line) => line.startsWith("git tag ")));
  assert.deepEqual(tagCommands, [`git tag -a ${EXPECTED_RELEASE_TAG} "$RELEASE_COMMIT" -m "planloft ${EXPECTED_RELEASE_TAG}"`]);
  const tag = uniqueExecutableLine(bashBlocks, tagCommands[0]!);
  assert.ok(registryShasum < tag && registryIntegrity < tag, "registry equality must precede tag creation");

  const cleanupGuard = uniqueExecutableLine(bashBlocks, 'test -n "$RELEASE_ROOT"');
  const cleanupCheckoutGuard = uniqueExecutableLine(bashBlocks, 'test -n "$RELEASE_CHECKOUT"');
  const cleanupCase = uniqueExecutableLine(bashBlocks, 'case "$RELEASE_ROOT" in');
  const cleanupEquality = uniqueExecutableLine(
    bashBlocks,
    'test "$RELEASE_CHECKOUT" = "$RELEASE_ROOT/checkout"',
  );
  const worktreeRemove = uniqueExecutableLine(bashBlocks, 'git worktree remove "$RELEASE_CHECKOUT"');
  const destructiveLines = bashBlocks.flatMap((block) => block.lines.filter((line) => /^rm\s+-rf(?:\s|$)/.test(line)));
  assert.deepEqual(destructiveLines, ['rm -rf -- "$RELEASE_ROOT"']);
  const destructiveRemove = uniqueExecutableLine(bashBlocks, destructiveLines[0]!);
  for (const guard of [cleanupGuard, cleanupCheckoutGuard, cleanupCase, cleanupEquality]) {
    assert.ok(guard < worktreeRemove && guard < destructiveRemove, "cleanup guard must precede removals");
  }
  assert.ok(worktreeRemove < destructiveRemove, "worktree removal must precede directory deletion");
}

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

test("release Markdown parser isolates and syntax-checks executable Bash", () => {
  const sample = [
    "# Example",
    'Prose says npm publish --access public "$CANDIDATE_PATH" but is not executable.',
    '<!-- rm -rf -- "$RELEASE_ROOT" -->',
    "```text",
    'git tag -a v0.1.0 "$RELEASE_COMMIT"',
    "```",
    "```bash",
    "set -eu",
    'test -n "$RELEASE_ROOT"',
    "```",
  ].join("\n");
  const parsed = parseExecutableMarkdown(sample);
  assert.equal(parsed.bashBlocks.length, 1);
  assert.deepEqual(parsed.bashBlocks[0]!.lines, ["set -eu", 'test -n "$RELEASE_ROOT"']);
  assert.equal(executableLineLocations(parsed.bashBlocks, 'npm publish --access public "$CANDIDATE_PATH"').length, 0);
  assert.equal(executableLineLocations(parsed.bashBlocks, 'rm -rf -- "$RELEASE_ROOT"').length, 0);
  assert.equal(executableLineLocations(parsed.bashBlocks, 'git tag -a v0.1.0 "$RELEASE_COMMIT"').length, 0);

  for (const block of parseExecutableMarkdown(read("docs/releasing.md")).bashBlocks) {
    const syntax = spawnSync("bash", ["-n"], { input: `${block.code}\n`, encoding: "utf8" });
    assert.equal(syntax.status, 0, `invalid Bash under ${block.heading}: ${syntax.stderr}`);
  }
});

test("release runbook executable blocks enforce prepublish, tag, and cleanup ordering", () => {
  const guide = read("docs/releasing.md");
  assertReleaseExecutableSafety(guide);

  const proseCannotReplaceGuard = guide.replace(
    'test -z "$FINAL_REMOTE_TAG_PRECHECK"',
    '# remote absence is described in prose\ntrue',
  ) + '\n<!-- test -z "$FINAL_REMOTE_TAG_PRECHECK" -->\n';
  assert.throws(
    () => assertReleaseExecutableSafety(proseCannotReplaceGuard),
    /expected one Bash block containing|expected one executable line/,
  );

  const reorderedCleanup = guide.replace(
    'test "$RELEASE_CHECKOUT" = "$RELEASE_ROOT/checkout"\ngit worktree remove "$RELEASE_CHECKOUT"',
    'git worktree remove "$RELEASE_CHECKOUT"\ntest "$RELEASE_CHECKOUT" = "$RELEASE_ROOT/checkout"',
  );
  assert.throws(() => assertReleaseExecutableSafety(reorderedCleanup), /cleanup guard must precede removals/);

  const unsafeDeletion = guide.replace('rm -rf -- "$RELEASE_ROOT"', "rm -rf -- $RELEASE_ROOT");
  assert.throws(() => assertReleaseExecutableSafety(unsafeDeletion), /expected one Bash block containing/);

  const { headings } = parseExecutableMarkdown(guide);
  for (const expected of [
    "Release-state overview",
    "Prerequisites and operating assumptions",
    "1. Pin a clean release checkout",
    "2. Verify tools, npm identity, and version availability",
    "3. Run deterministic release gates",
    "4. Create and inspect the one candidate tarball",
    "5. Revalidate immediately before publication",
    "Final external availability checks",
    "Decision checkpoint: publish to npm",
    "6. Verify registry bytes before tagging",
    "Decision checkpoint: create and push the tag",
    "7. Validate released installation surfaces",
    "8. Record evidence and clean up",
    "Failure and recovery guide",
  ]) {
    uniqueHeadingLine(headings, expected);
  }

  assert.match(read("docs/README.md"), /\[operator release\s+runbook\]\(\.\/releasing\.md\)/);
});
