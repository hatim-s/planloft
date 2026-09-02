import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { compareVersions, validateReleaseVersion } from "../scripts/release.js";
import { createProgram } from "../src/program.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (file: string) => fs.readFileSync(path.join(ROOT, file), "utf8");
const packageJson = JSON.parse(read("package.json")) as {
  version: string;
  scripts: Record<string, string>;
};

test("package and CLI versions match", () => {
  assert.equal(createProgram().version(), packageJson.version);
});

test("release versions are stable and monotonic", () => {
  assert.equal(compareVersions("0.2.5", "0.2.4"), 1);
  assert.equal(compareVersions("1.0.0", "1.0.0"), 0);
  assert.equal(compareVersions("1.0.0", "2.0.0"), -1);
  assert.doesNotThrow(() => validateReleaseVersion("0.2.4", "0.2.5"));
  assert.doesNotThrow(() => validateReleaseVersion("0.2.4", "0.2.4"));
  assert.throws(() => validateReleaseVersion("0.2.4", "0.2.3"), /older/);
  assert.throws(() => validateReleaseVersion("0.2.4", "next"), /stable version/);
});

test("one release command owns versioning, publishing, and tagging", () => {
  assert.equal(packageJson.scripts.release, "bun scripts/release.ts");
  assert.equal(packageJson.scripts["release:prepare"], undefined);
  assert.equal(packageJson.scripts["release:publish"], undefined);

  const help = spawnSync("bun", ["run", "release", "--help"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /bun run release <version>/);

  const guide = read("docs/releasing.md");
  assert.match(guide, /bun run release 0\.2\.5/);
  assert.doesNotMatch(guide, /release:prepare|release:publish|PLANLOFT_PUBLISH/);
  assert.match(guide, /updates `package\.json`/i);
  assert.match(guide, /commits and pushes `main`/i);
});
