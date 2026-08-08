#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tarball = process.argv[2];
if (!tarball) {
  console.error("Usage: node scripts/validate-packed-plugin.mjs <planloft.tgz>");
  process.exit(2);
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), "planloft-packed-plugin-"));
try {
  const extraction = spawnSync("tar", ["-xzf", path.resolve(tarball), "-C", root], { encoding: "utf8" });
  assert.equal(extraction.status, 0, extraction.stderr);

  const pluginRoot = path.join(root, "package");
  const bridge = path.join(pluginRoot, "bin", "planloft");
  const resolver = path.join(pluginRoot, "skills", "write-plan", "scripts", "resolve-planloft-command.sh");
  for (const required of [
    bridge,
    resolver,
    path.join(pluginRoot, "dist", "cli.js"),
    path.join(pluginRoot, "hooks", "hooks.json"),
    path.join(pluginRoot, ".codex-plugin", "plugin.json"),
    path.join(pluginRoot, ".claude-plugin", "plugin.json"),
  ]) assert.ok(fs.existsSync(required), `packed plugin is missing ${path.relative(pluginRoot, required)}`);
  assert.ok(fs.statSync(bridge).mode & 0o111, "packed bin/planloft is not executable");
  assert.ok(fs.statSync(resolver).mode & 0o111, "packed skill resolver is not executable");

  const runnerBin = path.join(root, "runner-bin");
  fs.mkdirSync(runnerBin);
  const node = process.execPath;
  const nodeWrapper = path.join(runnerBin, "node");
  fs.writeFileSync(nodeWrapper, `#!/bin/sh\nexec "${node}" "$@"\n`, { mode: 0o755 });
  const planloftHome = path.join(root, "planloft-home");
  const env = {
    ...process.env,
    HOME: path.join(root, "home"),
    PLANLOFT_HOME: planloftHome,
    PLUGIN_ROOT: pluginRoot,
    CLAUDE_PLUGIN_ROOT: pluginRoot,
    PATH: `${runnerBin}:/usr/bin:/bin`,
  };

  const version = spawnSync(bridge, ["--version"], { cwd: root, env, encoding: "utf8" });
  assert.equal(version.status, 0, version.stderr);
  assert.equal(version.stdout.trim(), JSON.parse(fs.readFileSync(path.join(pluginRoot, "package.json"), "utf8")).version);

  const resolved = spawnSync(resolver, [], { cwd: root, env, encoding: "utf8" });
  assert.equal(resolved.status, 0, resolved.stderr);
  assert.equal(resolved.stdout.trim(), bridge);

  const command = spawnSync(resolved.stdout.trim(), [
    "resolve", "--kind", "plan", "--slug", "packed-plugin", "--title", "Packed plugin",
  ], { cwd: root, env, encoding: "utf8" });
  assert.equal(command.status, 0, command.stderr);
  assert.ok(command.stdout.includes(planloftHome), "packed bridge resolve did not use the disposable Planloft home");

  console.log("packed plugin: bridge, skill resolver, hooks, and both manifests PASS");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
