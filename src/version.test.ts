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

function bashBlocks(markdown: string): string[] {
  return [...markdown.matchAll(/^```bash\s*\n([\s\S]*?)^```\s*$/gm)].map((match) => match[1]!);
}

test("package, CLI, plugins, and marketplaces use the prepared release version", () => {
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
  assert.equal(codexMarketplace.plugins[0]!.source.package, "planloft");
  assert.equal(codexMarketplace.plugins[0]!.source.version, EXPECTED_RELEASE_VERSION);
  assert.equal(claudeMarketplace.plugins[0]!.source.package, "planloft");
  assert.equal(claudeMarketplace.plugins[0]!.source.version, EXPECTED_RELEASE_VERSION);
  assert.equal(claudeMarketplace.plugins[0]!.version, EXPECTED_RELEASE_VERSION);
});

test("release-facing documentation pins 0.1.0 and v0.1.0", () => {
  const readme = read("README.md");
  const docsReadme = read("docs/README.md");
  const releaseGuide = read("docs/releasing.md");

  assert.ok(readme.includes(`planloft@${EXPECTED_RELEASE_VERSION}`));
  assert.ok(readme.includes(`/tree/${EXPECTED_RELEASE_TAG}/skills/write-plan`));
  assert.ok(readme.includes(`--ref ${EXPECTED_RELEASE_TAG}`));
  assert.ok(readme.includes(`.git#${EXPECTED_RELEASE_TAG}`));
  assert.ok(docsReadme.includes(`PLANLOFT_RELEASE_TAG=${EXPECTED_RELEASE_TAG}`));
  assert.ok(releaseGuide.includes(`npm view planloft@${EXPECTED_RELEASE_VERSION} version`));
  assert.ok(releaseGuide.includes(`git tag -a ${EXPECTED_RELEASE_TAG}`));
  assert.ok(releaseGuide.includes(`PLANLOFT_RELEASE_TAG=${EXPECTED_RELEASE_TAG}`));

  for (const file of AUTHORITATIVE_RELEASE_FILES) {
    const contents = read(file);
    assert.ok(!contents.includes("0.0.1"), `${file} contains the previous release version`);
    for (const match of contents.matchAll(/planloft@(\d+\.\d+\.\d+)/g)) {
      assert.equal(match[1], EXPECTED_RELEASE_VERSION, `${file} contains a different npm version`);
    }
    for (const match of contents.matchAll(/(?:\/tree\/|--ref\s+|\.git#|PLANLOFT_RELEASE_TAG=)(v\d+\.\d+\.\d+)/g)) {
      assert.equal(match[1], EXPECTED_RELEASE_TAG, `${file} contains a different release tag`);
    }
  }
});

test("release guide is a short, ordered, executable operator flow", () => {
  const guide = read("docs/releasing.md");
  const headings = [
    "## Before you start",
    "## 1. Sync and verify `main`",
    "## 2. Install dependencies and run the release checks",
    "## 3. Build one package candidate",
    "## 4. Recheck, then publish to npm",
    "## 5. Verify npm, then create the Git tag",
    "## 6. Verify released installation paths",
    "## 7. Clean up",
    "## If a step fails",
  ];

  let previous = -1;
  for (const heading of headings) {
    const position = guide.indexOf(heading);
    assert.ok(position > previous, `missing or misplaced release heading: ${heading}`);
    previous = position;
  }

  const commands = [
    "pnpm test",
    'npm pack --pack-destination "$RELEASE_DIR"',
    'npm publish --dry-run "$CANDIDATE"',
    'npm publish --access public "$CANDIDATE"',
    `git tag -a ${EXPECTED_RELEASE_TAG}`,
    `PLANLOFT_RELEASE_TAG=${EXPECTED_RELEASE_TAG} pnpm test:installer:release`,
  ];
  previous = -1;
  for (const command of commands) {
    const position = guide.indexOf(command);
    assert.ok(position > previous, `missing or misplaced release command: ${command}`);
    previous = position;
  }

  assert.equal(
    guide.split("\n").filter((line) => line.startsWith("npm publish --access public ")).length,
    1,
    "the guide should contain one real npm publish command",
  );
  assert.match(guide, /E404[\s\S]+Stop if npm reports/);
  assert.match(guide, /do not immediately retry[\s\S]+npm view planloft@0\.1\.0 version/i);
  assert.match(guide, /Never move or force-push a published release tag/);

  const blocks = bashBlocks(guide);
  assert.ok(blocks.length > 0);
  for (const block of blocks) {
    const syntax = spawnSync("bash", ["-n"], { input: `${block}\n`, encoding: "utf8" });
    assert.equal(syntax.status, 0, syntax.stderr);
  }

  assert.match(read("docs/README.md"), /\[step-by-step release\s+guide\]\(\.\/releasing\.md\)/);
});
