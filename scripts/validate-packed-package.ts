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
  "templates/github-pages/prune.mjs",
  "templates/github-pages/update-indexes.mjs",
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

function validatePackedTemplates(root: string, packageRoot: string): void {
  const prune = path.join(packageRoot, "templates", "github-pages", "prune.mjs");
  const updateIndexes = path.join(packageRoot, "templates", "github-pages", "update-indexes.mjs");
  run("node", ["--check", prune], root);
  run("node", ["--check", updateIndexes], root);

  const site = path.join(root, "template-site");
  const id = "live-template-smoke";
  const title = "Live template smoke";
  const pagesBaseUrl = "https://example.test/packed-plans";
  const now = "2026-05-15T12:00:00.000Z";
  fs.mkdirSync(site);
  fs.writeFileSync(
    path.join(site, "manifest.json"),
    `${JSON.stringify({
      version: 1,
      deploys: [{
        id,
        project: "packed/smoke",
        slug: "template-smoke",
        title,
        kind: "plan",
        createdAt: "2026-05-01T00:00:00.000Z",
        expiresAt: "2026-06-01T00:00:00.000Z",
      }],
    }, null, 2)}\n`,
  );

  run("node", [updateIndexes, "--pages-base-url", pagesBaseUrl, "--now", now], site);

  const readme = fs.readFileSync(path.join(site, "README.md"), "utf8");
  const index = fs.readFileSync(path.join(site, "index.html"), "utf8");
  assert.ok(
    readme.includes(`[${title}](${pagesBaseUrl}/p/${id}/)`),
    "packed update-indexes README omitted the live deployment",
  );
  assert.ok(
    index.includes(`href="./p/${id}/"`) && index.includes(`<h2>${title}</h2>`),
    "packed update-indexes root index omitted the live deployment",
  );

  const pruneSite = path.join(root, "prune-site");
  const remote = path.join(root, "prune-site-remote.git");
  const liveId = "live-prune-smoke";
  const expiredId = "expired-prune-smoke";
  const liveTitle = "Live prune smoke";
  const expiredTitle = "Expired prune smoke";
  const installedScripts = path.join(pruneSite, ".planloft");
  fs.mkdirSync(installedScripts, { recursive: true });
  fs.copyFileSync(prune, path.join(installedScripts, "prune.mjs"));
  fs.copyFileSync(updateIndexes, path.join(installedScripts, "update-indexes.mjs"));
  fs.writeFileSync(
    path.join(pruneSite, "manifest.json"),
    `${JSON.stringify({
      version: 1,
      deploys: [
        {
          id: liveId,
          project: "packed/prune",
          slug: "live-prune-smoke",
          title: liveTitle,
          kind: "plan",
          createdAt: "2026-05-01T00:00:00.000Z",
          expiresAt: null,
        },
        {
          id: expiredId,
          project: "packed/prune",
          slug: "expired-prune-smoke",
          title: expiredTitle,
          kind: "plan",
          createdAt: "2025-05-01T00:00:00.000Z",
          expiresAt: "2000-06-01T00:00:00.000Z",
        },
      ],
    }, null, 2)}\n`,
  );
  fs.writeFileSync(path.join(pruneSite, "README.md"), "# Packed prune smoke\n");
  fs.writeFileSync(path.join(pruneSite, "index.html"), "stale index\n");
  for (const [planId, contents] of [[liveId, liveTitle], [expiredId, expiredTitle]] as const) {
    const plan = path.join(pruneSite, "p", planId);
    fs.mkdirSync(plan, { recursive: true });
    fs.writeFileSync(path.join(plan, "index.html"), `<!doctype html><title>${contents}</title>\n`);
  }

  run("git", ["init", "--bare", remote], root);
  run("git", ["symbolic-ref", "HEAD", "refs/heads/main"], remote);
  run("git", ["init"], pruneSite);
  run("git", ["branch", "-M", "main"], pruneSite);
  run("git", ["config", "user.name", "packed-template-smoke"], pruneSite);
  run("git", ["config", "user.email", "packed-template-smoke@example.test"], pruneSite);
  run("git", ["remote", "add", "origin", remote], pruneSite);
  run("git", ["add", "-A"], pruneSite);
  run("git", ["commit", "-m", "prune fixture"], pruneSite);
  run("git", ["push", "-u", "origin", "HEAD:main"], pruneSite);

  const initialCommit = run("git", ["rev-parse", "HEAD"], pruneSite);
  assert.equal(run("git", ["rev-parse", "refs/heads/main"], remote), initialCommit);
  run("node", [".planloft/prune.mjs"], pruneSite);

  const prunedManifest = JSON.parse(
    fs.readFileSync(path.join(pruneSite, "manifest.json"), "utf8"),
  ) as { deploys: Array<{ id: string }> };
  assert.deepEqual(
    prunedManifest.deploys.map(({ id: deployId }) => deployId),
    [liveId],
    "packed prune retained the expired manifest entry",
  );
  assert.equal(
    fs.existsSync(path.join(pruneSite, "p", expiredId)),
    false,
    "packed prune retained the expired plan folder",
  );
  assert.equal(
    fs.existsSync(path.join(pruneSite, "p", liveId)),
    true,
    "packed prune removed the live plan folder",
  );

  const prunedReadme = fs.readFileSync(path.join(pruneSite, "README.md"), "utf8");
  const prunedIndex = fs.readFileSync(path.join(pruneSite, "index.html"), "utf8");
  assert.ok(
    prunedReadme.includes(`[${liveTitle}](p/${liveId}/)`) && !prunedReadme.includes(expiredTitle),
    "packed prune did not refresh the README for the live deployment",
  );
  assert.ok(
    prunedIndex.includes(`href="./p/${liveId}/"`) &&
      prunedIndex.includes(`<h2>${liveTitle}</h2>`) &&
      !prunedIndex.includes(expiredTitle),
    "packed prune did not refresh the root index for the live deployment",
  );

  const pruneCommit = run("git", ["rev-parse", "HEAD"], pruneSite);
  assert.notEqual(pruneCommit, initialCommit, "packed prune did not commit its changes");
  assert.equal(
    run("git", ["rev-parse", "refs/heads/main"], remote),
    pruneCommit,
    "packed prune did not push main to the local bare remote",
  );
  const remoteManifest = JSON.parse(
    run("git", ["show", "main:manifest.json"], remote),
  ) as { deploys: Array<{ id: string }> };
  assert.deepEqual(
    remoteManifest.deploys.map(({ id: deployId }) => deployId),
    [liveId],
    "packed remote manifest retained the expired deployment",
  );
  assert.ok(
    run("git", ["show", "main:README.md"], remote).includes(`[${liveTitle}](p/${liveId}/)`),
    "packed remote README omitted the live deployment",
  );
  assert.ok(
    run("git", ["show", "main:index.html"], remote).includes(`href="./p/${liveId}/"`),
    "packed remote index omitted the live deployment",
  );
  run("git", ["cat-file", "-e", `main:p/${liveId}/index.html`], remote);
  assert.throws(() => run("git", ["cat-file", "-e", `main:p/${expiredId}`], remote));
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

    validatePackedTemplates(root, packageRoot);

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
    console.log("packed package: files, templates, CLI, skill resolver, and Node consumer PASS");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const tarball = process.argv[2];
if (!tarball) throw new Error("Usage: bun scripts/validate-packed-package.ts <planloft.tgz>");
validatePackedPackage(tarball);
