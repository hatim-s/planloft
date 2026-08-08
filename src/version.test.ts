import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { createProgram } from "./program.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (file: string) => fs.readFileSync(path.join(ROOT, file), "utf8");
const readJson = (file: string) => JSON.parse(read(file)) as Record<string, unknown>;
const RELEASE_VERSION = String(readJson("package.json").version);
const RELEASE_TAG = `v${RELEASE_VERSION}`;

test("package, CLI, plugin manifests, and marketplace npm pins share the release version", () => {
  const packageJson = readJson("package.json");
  const codexPlugin = readJson(".codex-plugin/plugin.json");
  const claudePlugin = readJson(".claude-plugin/plugin.json");
  const codexMarketplace = readJson(".agents/plugins/marketplace.json") as {
    plugins: Array<{ source: { package: string; version: string } }>;
  };
  const claudeMarketplace = readJson(".claude-plugin/marketplace.json") as {
    plugins: Array<{ version: string; source: { package: string; version: string } }>;
  };

  assert.equal(packageJson.version, RELEASE_VERSION);
  assert.equal(createProgram().version(), RELEASE_VERSION);
  assert.equal(codexPlugin.version, RELEASE_VERSION);
  assert.equal(claudePlugin.version, RELEASE_VERSION);
  assert.equal(codexMarketplace.plugins.length, 1);
  assert.equal(codexMarketplace.plugins[0]!.source.package, "planloft");
  assert.equal(codexMarketplace.plugins[0]!.source.version, RELEASE_VERSION);
  assert.equal(claudeMarketplace.plugins[0]!.source.package, "planloft");
  assert.equal(claudeMarketplace.plugins[0]!.source.version, RELEASE_VERSION);
  assert.equal(claudeMarketplace.plugins[0]!.version, RELEASE_VERSION);
});

test("release-facing documentation pins the prepared npm version and matching tag", () => {
  const readme = read("README.md");
  const releaseGuide = read("docs/releasing.md");
  const docsReadme = read("docs/README.md");

  assert.ok(readme.includes(`planloft@${RELEASE_VERSION}`));
  assert.ok(readme.includes(`/tree/${RELEASE_TAG}/skills/write-plan`));
  assert.ok(readme.includes(`--ref ${RELEASE_TAG}`));
  assert.ok(readme.includes(`.git#${RELEASE_TAG}`));
  assert.ok(docsReadme.includes(`PLANLOFT_RELEASE_TAG=${RELEASE_TAG}`));
  assert.ok(docsReadme.includes(`planloft-${RELEASE_VERSION}.tgz`));
  assert.ok(releaseGuide.includes(`npm view planloft@${RELEASE_VERSION} version`));
  assert.ok(releaseGuide.includes(`git tag -a ${RELEASE_TAG}`));
  assert.ok(releaseGuide.includes(`PLANLOFT_RELEASE_TAG=${RELEASE_TAG}`));

  const priorVersion = ["0", "0", "1"].join(".");
  for (const stale of [priorVersion, `v${priorVersion}`]) {
    for (const file of [
      "package.json",
      "README.md",
      "docs/README.md",
      "docs/releasing.md",
      ".codex-plugin/plugin.json",
      ".agents/plugins/marketplace.json",
      ".claude-plugin/plugin.json",
      ".claude-plugin/marketplace.json",
    ]) assert.ok(!read(file).includes(stale), `${file} contains stale release version ${stale}`);
  }
});
