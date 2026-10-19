import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { prepareHostingRepository, readManifest } from "../src/hosts/layout.js";
import { loadConfig, saveConfig, updateConfig, redactConfig, validateConfig } from "../src/configuration.js";

import { withPlanloftHome } from "../src/core/paths.js";

const root = path.resolve(import.meta.dirname, "..");
const entry = { id: "stable-id", project: "project", slug: "proposal", title: "Proposal", kind: "plan", createdAt: "2026-01-01T00:00:00.000Z", expiresAt: "2099-01-01T00:00:00.000Z" };
function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "planloft-hosting-"));
  fs.mkdirSync(path.join(dir, "p", entry.id), { recursive: true });
  fs.writeFileSync(path.join(dir, "p", entry.id, "index.html"), "<!doctype html>旧 plan\r\n");
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({ version: 1, deploys: [entry] }));
  return dir;
}

test("migration preserves bytes, IDs, root HTML and relative assets and is repeatable", () => {
  const dir = fixture();
  try {
    fs.writeFileSync(path.join(dir, "extra.html"), '<img src="assets/example.svg">');
    fs.mkdirSync(path.join(dir, "assets"));
    fs.writeFileSync(path.join(dir, "assets", "example.svg"), "<svg/>");
    fs.writeFileSync(path.join(dir, "README.md"), "Repository notes");
    const before = fs.readFileSync(path.join(dir, "p", entry.id, "index.html"));
    assert.deepEqual(prepareHostingRepository(dir), { migrated: true });
    assert.deepEqual(fs.readFileSync(path.join(dir, "public", "p", entry.id, "index.html")), before);
    assert.deepEqual(readManifest(dir).deploys, [entry]);
    assert.equal(fs.readFileSync(path.join(dir, "public", "extra.html"), "utf8"), '<img src="assets/example.svg">');
    assert.ok(fs.existsSync(path.join(dir, "public", "assets", "example.svg")));
    assert.equal(fs.readFileSync(path.join(dir, "README.md"), "utf8"), "Repository notes");
    assert.ok(!fs.existsSync(path.join(dir, "p")));
    assert.deepEqual(prepareHostingRepository(dir), { migrated: false });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("migration fails before moving data on collisions, unsafe IDs, symlinks, and missing pages", () => {
  for (const problem of ["collision", "id", "symlink", "missing"] as const) {
    const dir = fixture();
    try {
      if (problem === "collision") fs.mkdirSync(path.join(dir, "public", "p"), { recursive: true });
      if (problem === "id") fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({ version: 1, deploys: [{ ...entry, id: "../outside" }] }));
      if (problem === "symlink") fs.symlinkSync("manifest.json", path.join(dir, "extra.html"));
      if (problem === "missing") fs.unlinkSync(path.join(dir, "p", entry.id, "index.html"));
      assert.throws(() => prepareHostingRepository(dir), /PLANLOFT_HOSTING_INVALID:/);
      assert.ok(fs.existsSync(path.join(dir, "p")));
      assert.ok(!fs.existsSync(path.join(dir, ".planloft", "layout.json")));
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
});

test("publication uses one whole-site Vercel project and stable IDs across hosts", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "planloft-publish-"));
  const env = { ...process.env, HOME: dir, PLANLOFT_HOME: path.join(dir, "home"), PATH: `${path.join(dir, "bin")}:${process.env.PATH}`, GIT_CONFIG_NOSYSTEM: "1" };
  const git = (args: string[], cwd = dir) => execFileSync("git", args, { cwd, env, stdio: "pipe", encoding: "utf8" });
  const cli = (...args: string[]) => {
    const result = spawnSync(process.execPath, [path.join(root, "node_modules/tsx/dist/cli.mjs"), path.join(root, "src/cli.ts"), ...args], { cwd: path.join(dir, "project"), env, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  };
  try {
    fs.mkdirSync(path.join(dir, "bin"));
    fs.mkdirSync(path.join(dir, "project"));
    fs.mkdirSync(env.PLANLOFT_HOME);
    git(["init", "--bare", "--initial-branch=main", "remote.git"]);
    git(["clone", path.join(dir, "remote.git"), "seed"]);
    git(["config", "user.name", "test"], path.join(dir, "seed"));
    git(["config", "user.email", "test@example.test"], path.join(dir, "seed"));
    fs.writeFileSync(path.join(dir, "seed", "README.md"), "Plans");
    git(["add", "."], path.join(dir, "seed"));
    git(["commit", "-m", "init"], path.join(dir, "seed"));
    git(["push", "origin", "main"], path.join(dir, "seed"));
    git(["config", "--global", `url.file://${path.join(dir, "remote.git")}.insteadOf`, "https://github.com/test/planloft-plans.git"]);
    fs.writeFileSync(path.join(dir, "bin", "gh"), `#!/bin/sh\ncase "$*" in\n  'auth status') exit 0;;\n  'auth token') echo github-test-token;;\n  *user) echo '{"login":"test"}';;\n  *) echo '{}';;\nesac\n`, { mode: 0o755 });
    fs.writeFileSync(path.join(dir, "bin", "vercel"), `#!/bin/sh\nprintf '%s\\n' "$*" >> "$HOME/vercel-calls"\ncase "$1" in\n  whoami) echo test;;\n  link) mkdir -p .vercel; echo '{}' > .vercel/project.json;;\n  deploy) test -f public/index.html || exit 1; cp -R public "$HOME/deployed"; echo '{ "status": "ok", "deployment": { "url": "https://deployment-test.vercel.app", "readyState": "READY" } }';;\n  alias) exit 0;;\nesac\n`, { mode: 0o755 });
    const cfg = { version: 1, theme: "minimal", defaultTtlDays: 30, projects: {}, host: "vercel", vercel: { project: "shared-plans", token: "vercel-test-token" } };
    fs.writeFileSync(path.join(env.PLANLOFT_HOME, "config.json"), JSON.stringify(cfg));
    fs.writeFileSync(path.join(dir, "project", "first.md"), "# First plan\n\nHello.");
    const first = cli("publish", "first.md");
    assert.match(first, /https:\/\/shared-plans.vercel.app\/p\/[A-Za-z0-9_-]+\//);
    const clone = path.join(env.PLANLOFT_HOME, "hosting", "planloft-plans");
    const firstId = readManifest(clone).deploys[0]!.id;
    fs.writeFileSync(path.join(dir, "project", "second.md"), "# Second plan\n\nHello again.");
    cli("publish", "second.md");
    assert.equal(readManifest(clone).deploys.length, 2);
    assert.ok(fs.existsSync(path.join(clone, "public", "p", firstId, "index.html")));
    const again = cli("deploy", "first-plan", "--host", "github-pages");
    assert.match(again, new RegExp(`https://test.github.io/planloft-plans/p/${firstId}/`));
    assert.equal(readManifest(clone).deploys.length, 2);
    const calls = fs.readFileSync(path.join(dir, "vercel-calls"), "utf8");
    assert.match(calls, /link --yes --project shared-plans/);
    assert.match(calls, /deploy --prod --yes --json/);
    assert.match(calls, /alias set https:\/\/deployment-test.vercel.app shared-plans.vercel.app/);
    assert.doesNotMatch(calls, /vercel-test-token/);
    assert.ok(fs.existsSync(path.join(dir, "deployed", "p", firstId, "index.html")));
    assert.ok(!git(["ls-tree", "-r", "HEAD", "--name-only"], clone).includes(".vercel/project.json"));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("new provider configuration validates and redacts tokens", () => {
  const cfg = validateConfig({ version: 1, theme: "minimal", defaultTtlDays: 30, projects: {}, host: "vercel", vercel: { token: "secret", project: "shared", scope: "team", url: "https://plans.example.test" } });
  assert.deepEqual(redactConfig(cfg).vercel, { token: "[redacted]", project: "shared", scope: "team", url: "https://plans.example.test" });
  assert.throws(() => validateConfig({ ...cfg, host: "unknown" }), /host must be github-pages or vercel/);
});

test("scheduled prune removes only expired public pages and signals a redeploy", () => {
  const dir = fixture();
  try {
    const expired = { ...entry, id: "expired", slug: "expired", expiresAt: "2000-01-01T00:00:00.000Z" };
    fs.mkdirSync(path.join(dir, "p", "expired"));
    fs.writeFileSync(path.join(dir, "p", "expired", "index.html"), "Expired");
    fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({ version: 1, deploys: [entry, expired] }));
    prepareHostingRepository(dir);
    execFileSync("git", ["init"], { cwd: dir, stdio: "ignore" });
    execFileSync("git", ["config", "user.name", "test"], { cwd: dir });
    execFileSync("git", ["config", "user.email", "test@example.test"], { cwd: dir });
    execFileSync("git", ["add", "-A"], { cwd: dir });
    execFileSync("git", ["commit", "-m", "initial"], { cwd: dir, stdio: "ignore" });
    const remote = path.join(dir, ".remote.git");
    execFileSync("git", ["init", "--bare", remote], { stdio: "ignore" });
    execFileSync("git", ["remote", "add", "origin", remote], { cwd: dir });
    execFileSync("git", ["push", "-u", "origin", "HEAD"], { cwd: dir, stdio: "ignore" });
    const output = path.join(dir, ".github-output");
    const result = execFileSync(process.execPath, [path.join(dir, ".planloft", "prune.mjs")], { cwd: dir, env: { ...process.env, GITHUB_OUTPUT: output }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    assert.match(result, /removed 1, kept 1/);
    assert.deepEqual(readManifest(dir).deploys, [entry]);
    assert.ok(!fs.existsSync(path.join(dir, "public", "p", "expired")));
    assert.ok(fs.existsSync(path.join(dir, "public", "p", entry.id, "index.html")));
    assert.match(fs.readFileSync(output, "utf8"), /changed=true/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});


test("host selection persists through targeted config updates", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "planloft-provider-config-"));
  try {
    await withPlanloftHome(dir, () => {
      saveConfig({ version: 1, theme: "minimal", defaultTtlDays: 30, projects: {} });
      updateConfig({ host: "vercel", vercel: { project: "shared-plans" } });
      assert.equal(loadConfig().host, "vercel");
      updateConfig({ defaultTtlDays: 45 });
      assert.equal(loadConfig().host, "vercel");
      assert.equal(loadConfig().vercel?.project, "shared-plans");
      updateConfig({ host: "github-pages" });
      assert.equal(loadConfig().host, "github-pages");
    });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
