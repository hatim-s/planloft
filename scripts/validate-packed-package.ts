#!/usr/bin/env bun

/**
 * Validates the exact npm tarball that the release command will publish.
 * The checks run only inside a temporary directory.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const REQUIRED_FILES = [
  "dist/cli.js",
  "dist/index.js",
  "dist/index.d.ts",
  "skills/planloft-write-doc/SKILL.md",
  "skills/planloft-write-doc/scripts/resolve-planloft-command.sh",
  "skills/planloft-customise/SKILL.md",
  "skills/planloft-customise/references/themes.md",
  "skills/planloft-customise/assets/theme-starter/style.css",
  "themes/editorial/style.css",
  "themes/briefing/template.md",
  "themes/decision/template.md",
  "themes/research/template.md",
  "themes/README.md",
  "schemas/config.schema.json",
  "templates/github-pages/prune-plans.yml",
] as const;
const RETIRED_PATHS = ["bin", "hooks", ".agents", ".codex-plugin", ".claude-plugin"] as const;

interface PackageJson {
  version: string;
}

function run(command: string, args: string[], cwd: string, env?: NodeJS.ProcessEnv): string {
  const result = spawnSync(command, args, { cwd, env: { ...process.env, ...env }, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

/** Imports the extracted package through Node's normal package resolution. */
function validateConsumer(root: string, packageRoot: string): void {
  const callerRoot = path.join(root, "consumer");
  const nodeModules = path.join(root, "node_modules");
  fs.mkdirSync(callerRoot);
  fs.mkdirSync(nodeModules);
  fs.symlinkSync(packageRoot, path.join(nodeModules, "planloft"), "dir");

  const consumer = path.join(callerRoot, "consumer.mjs");
  fs.writeFileSync(consumer, `
import assert from "node:assert/strict";
import { createPlanloftApplication } from "planloft";

const planloft = createPlanloftApplication({ cwd: process.cwd() });
const result = await planloft.resolve({
  kind: "plan",
  slug: "release-consumer",
  title: "Release consumer",
});
assert.ok(result.context.path.startsWith(process.env.PLANLOFT_HOME));
`);

  run("node", [consumer], callerRoot, { PLANLOFT_HOME: path.join(root, "consumer-home") });
}

/** Checks package contents, executables, CLI behavior, and Node consumption. */
function validatePackedPackage(tarball: string): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "planloft-packed-package-"));
  try {
    run("tar", ["-xzf", path.resolve(tarball), "-C", root], root);
    const packageRoot = path.join(root, "package");
    for (const required of REQUIRED_FILES) {
      assert.ok(fs.existsSync(path.join(packageRoot, required)), `packed package is missing ${required}`);
    }
    for (const retired of RETIRED_PATHS) {
      assert.ok(!fs.existsSync(path.join(packageRoot, retired)), `packed package contains retired ${retired} assets`);
    }

    const cli = path.join(packageRoot, "dist", "cli.js");
    const resolver = path.join(packageRoot, "skills", "planloft-write-doc", "scripts", "resolve-planloft-command.sh");
    assert.ok(fs.statSync(cli).mode & 0o111, "packed dist/cli.js is not executable");
    assert.ok(fs.statSync(resolver).mode & 0o111, "packed skill resolver is not executable");

    const runnerBin = path.join(root, "runner-bin");
    fs.mkdirSync(runnerBin);
    const wrapper = path.join(runnerBin, "planloft");
    fs.writeFileSync(wrapper, `#!/bin/sh\nexec node "${cli}" "$@"\n`, { mode: 0o755 });
    const planloftHome = path.join(root, "planloft-home");
    const env = { HOME: path.join(root, "home"), PLANLOFT_HOME: planloftHome, PATH: `${runnerBin}:${process.env.PATH}` };

    const packageJson = JSON.parse(fs.readFileSync(path.join(packageRoot, "package.json"), "utf8")) as PackageJson;
    assert.equal(run("node", [cli, "--version"], root, env), packageJson.version);
    assert.equal(run(resolver, [], root, env), wrapper);
    const resolved = run(
      wrapper,
      ["resolve", "--kind", "plan", "--slug", "packed-package", "--title", "Packed package"],
      root,
      env,
    );
    assert.ok(resolved.includes(planloftHome), "packed CLI resolve did not use the disposable Planloft home");

    validateConsumer(root, packageRoot);
    console.log("packed package: files, CLI, skill resolver, and Node consumer PASS");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const tarball = process.argv[2];
if (!tarball) throw new Error("Usage: bun scripts/validate-packed-package.ts <planloft.tgz>");
validatePackedPackage(tarball);
