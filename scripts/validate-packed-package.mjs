#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tarball = process.argv[2];
if (!tarball) {
  console.error("Usage: node scripts/validate-packed-package.mjs <planloft.tgz>");
  process.exit(2);
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), "planloft-packed-package-"));
try {
  const listing = spawnSync("tar", ["-tzf", path.resolve(tarball)], { encoding: "utf8" });
  assert.equal(listing.status, 0, listing.stderr);
  const packedFiles = listing.stdout.trim().split("\n").filter(Boolean);
  assert.equal(packedFiles.length, 37, `packed package has ${packedFiles.length} files instead of 37`);

  const extraction = spawnSync("tar", ["-xzf", path.resolve(tarball), "-C", root], { encoding: "utf8" });
  assert.equal(extraction.status, 0, extraction.stderr);

  const packageRoot = path.join(root, "package");
  const cli = path.join(packageRoot, "dist", "cli.js");
  const resolver = path.join(packageRoot, "skills", "planloft-write-doc", "scripts", "resolve-planloft-command.sh");
  for (const required of [
    cli,
    resolver,
    path.join(packageRoot, "skills", "planloft-write-doc", "SKILL.md"),
    path.join(packageRoot, "skills", "planloft-customise", "SKILL.md"),
    path.join(packageRoot, "skills", "planloft-customise", "references", "themes.md"),
    path.join(packageRoot, "skills", "planloft-customise", "assets", "theme-starter", "style.css"),
    path.join(packageRoot, "themes", "editorial", "style.css"),
    path.join(packageRoot, "themes", "briefing", "template.md"),
    path.join(packageRoot, "themes", "decision", "template.md"),
    path.join(packageRoot, "themes", "research", "template.md"),
    path.join(packageRoot, "themes", "README.md"),
    path.join(packageRoot, "schemas", "config.schema.json"),
    path.join(packageRoot, "templates", "github-pages", "prune-plans.yml"),
  ]) assert.ok(fs.existsSync(required), `packed package is missing ${path.relative(packageRoot, required)}`);
  assert.ok(fs.statSync(cli).mode & 0o111, "packed dist/cli.js is not executable");
  assert.ok(fs.statSync(resolver).mode & 0o111, "packed skill resolver is not executable");

  for (const removed of ["bin", "hooks", ".agents", ".codex-plugin", ".claude-plugin"]) {
    assert.ok(!fs.existsSync(path.join(packageRoot, removed)), `packed package contains retired ${removed} assets`);
  }

  const runnerBin = path.join(root, "runner-bin");
  fs.mkdirSync(runnerBin);
  const wrapper = path.join(runnerBin, "planloft");
  fs.writeFileSync(wrapper, `#!/bin/sh\nexec "${process.execPath}" "${cli}" "$@"\n`, { mode: 0o755 });
  const planloftHome = path.join(root, "planloft-home");
  const env = {
    ...process.env,
    HOME: path.join(root, "home"),
    PLANLOFT_HOME: planloftHome,
    PATH: `${runnerBin}:/usr/bin:/bin`,
  };

  const packageVersion = JSON.parse(fs.readFileSync(path.join(packageRoot, "package.json"), "utf8")).version;
  const version = spawnSync(process.execPath, [cli, "--version"], { cwd: root, env, encoding: "utf8" });
  assert.equal(version.status, 0, version.stderr);
  assert.equal(version.stdout.trim(), packageVersion);

  const resolved = spawnSync(resolver, [], { cwd: root, env, encoding: "utf8" });
  assert.equal(resolved.status, 0, resolved.stderr);
  assert.equal(resolved.stdout.trim(), wrapper);

  const command = spawnSync(resolved.stdout.trim(), [
    "resolve", "--kind", "plan", "--slug", "packed-package", "--title", "Packed package",
  ], { cwd: root, env, encoding: "utf8" });
  assert.equal(command.status, 0, command.stderr);
  assert.ok(command.stdout.includes(planloftHome), "packed CLI resolve did not use the disposable Planloft home");

  console.log("packed package: CLI, portable skills, themes, schemas, and templates PASS");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
