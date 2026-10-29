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
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const REQUIRED_FILES = [
  "dist/cli.js",
  "dist/index.js",
  "dist/index.d.ts",
  "dist/components/index.js",
  "dist/components/index.d.ts",
  "dist/components/styles.js",
  "src/collaboration/client.ts",
  "src/collaboration/client.css",
  "src/collaboration/anchors.ts",
  "src/collaboration/ui/notes.ts",
  "src/collaboration/ui/task-saves.ts",
  "templates/collaboration/local.mjs",
  "templates/collaboration/cloudflare.ts",
  "templates/collaboration/vercel.ts",
  "skills/planloft-migrate/SKILL.md",
  "skills/planloft-write-doc/SKILL.md",
  "skills/planloft-write-doc/scripts/resolve-planloft-command.sh",
  "skills/planloft-customise/SKILL.md",
  "skills/planloft-customise/references/themes.md",
  "skills/planloft-customise/assets/theme-starter/style.css",
  "themes/editorial/style.css",
  "themes/README.md",
  "schemas/config.schema.json",
  "templates/hosting/prune-plans.yml",
  "templates/hosting/pages.yml",
  "templates/hosting/vercel.json",
  "templates/hosting/prune.mjs",
] as const;
const RETIRED_PATHS = [
  "bin", "hooks", ".agents", ".codex-plugin", ".claude-plugin",
  ...["minimal", "detailed", "editorial", "decision", "research", "briefing"].flatMap(
    (theme) => ["template.md", "template.mdx", "layout.html"].map((asset) => `themes/${theme}/${asset}`),
  ),
] as const;

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
  fs.mkdirSync(nodeModules, { recursive: true });
  fs.symlinkSync(packageRoot, path.join(nodeModules, "planloft"), "dir");

  const consumer = path.join(callerRoot, "consumer.mjs");
  fs.writeFileSync(consumer, `
import assert from "node:assert/strict";
import { createPlanloftApplication, ingestDocument, renderMdxDocument, migrateDocument } from "planloft";
import { Callout } from "planloft/components";

const planloft = createPlanloftApplication({ cwd: process.cwd() });
const result = await planloft.resolve({
  kind: "plan",
  slug: "release-consumer",
  title: "Release consumer",
});
assert.ok(result.context.path.startsWith(process.env.PLANLOFT_HOME));
assert.equal(result.context.format, "md");
assert.ok(result.context.themeCss.includes("--planloft-ink"));
assert.ok(result.context.themePath.endsWith("style.css"));
assert.equal("template" in result.context, false);
assert.equal(typeof Callout, "function");
assert.equal(typeof migrateDocument, "function");
const source = ${JSON.stringify('import { Callout } from "planloft/components"\n\n# Package\n\n<Callout>Installed component</Callout>\n')};
const doc = ingestDocument(source, { format: "mdx", trustedMdx: true });
const html = await renderMdxDocument(doc, "minimal", { sourcePath: process.cwd() + "/source.mdx" });
assert.ok(html.includes("Installed component"));
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
    // The extracted archive uses the checkout's installed dependency versions, without modifying it.
    const dependencies = path.join(root, "node_modules");
    fs.mkdirSync(dependencies);
    for (const entry of fs.readdirSync(path.join(ROOT, "node_modules"))) {
      if (entry === "planloft") continue;
      fs.symlinkSync(path.join(ROOT, "node_modules", entry), path.join(dependencies, entry));
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

    const gallery = path.join(root, "gallery");
    run(wrapper, ["gallery", "--out", gallery], root, env);
    for (const theme of ["minimal", "detailed", "editorial", "decision", "research", "briefing"]) {
      assert.ok(fs.existsSync(path.join(gallery, "specimen", `${theme}.html`)));
      assert.ok(fs.existsSync(path.join(gallery, "components", `${theme}.html`)));
      assert.ok(fs.existsSync(path.join(gallery, "html", `${theme}.html`)));
    }
    const input = path.join(root, "source.html");
    const attached = path.join(root, "attached.html");
    fs.writeFileSync(input, "<!doctype html><html><body><main>Shared document</main></body></html>");
    run(wrapper, ["attach", input, "--out", attached, "--document-id", "packed", "--revision", "1", "--api-url", "https://example.test"], root, env);
    assert.match(fs.readFileSync(attached, "utf8"), /planloft-collaboration-config/);
    for (const provider of ["local", "cloudflare", "vercel"]) {
      const out = path.join(root, `service-${provider}`);
      run(wrapper, ["collaboration-build", "--provider", provider, "--out", out], root, env);
      assert.ok(fs.existsSync(path.join(out, "migration.sql")));
      const entry = provider === "local" ? "local.mjs" : provider === "cloudflare" ? "worker.mjs" : "api/index.mjs";
      assert.ok(fs.existsSync(path.join(out, entry)));
      if (provider !== "local") run("node", ["--input-type=module", "-e", "await import(process.argv[1])", new URL(`file://${path.join(out, entry)}`).href], root, env);
    }
    validateConsumer(root, packageRoot);
    console.log("packed package: files, gallery, attachment, service bundles, CLI, and Node consumer PASS");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const tarball = process.argv[2];
if (!tarball) throw new Error("Usage: bun scripts/validate-packed-package.ts <planloft.tgz>");
validatePackedPackage(tarball);
