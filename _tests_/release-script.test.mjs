import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const scriptPath = path.join(root, "scripts", "release.sh");
const script = fs.readFileSync(scriptPath, "utf8");
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

test("release commands use the checked-in guarded script", () => {
  assert.equal(packageJson.scripts["release:prepare"], "bash scripts/release.sh prepare");
  assert.equal(packageJson.scripts["release:publish"], "bash scripts/release.sh publish");

  const syntax = spawnSync("bash", ["-n", scriptPath], { encoding: "utf8" });
  assert.equal(syntax.status, 0, syntax.stderr);

  const help = spawnSync("bash", [scriptPath, "--help"], { cwd: root, encoding: "utf8" });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /prepare[\s\S]+publish/);

  assert.match(script, /PLANLOFT_PUBLISH:-/);
  assert.match(script, /npm publish --dry-run --access public "\$CANDIDATE"/);
  assert.equal(
    script.split("\n").filter((line) => line.trim() === 'npm publish --access public "$CANDIDATE"').length,
    1,
  );
  assert.match(script, /registry_sha1="\$\(npm view "\$PACKAGE_NAME@\$VERSION" dist\.shasum\)"/);
  assert.match(script, /PLANLOFT_RELEASE_TAG="\$TAG" pnpm test:installer:release/);
});
