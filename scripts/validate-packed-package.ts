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
  "dist/collaboration/client.js",
  "dist/collaboration/client.css",
  "dist/collaboration/service.js",
  "dist/collaboration/database.js",
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
  "src", "bin", "hooks", ".agents", ".codex-plugin", ".claude-plugin",
  ...["minimal", "detailed", "editorial", "decision", "research", "briefing"].flatMap(
    (theme) => ["template.md", "template.mdx", "layout.html"].map((asset) => `themes/${theme}/${asset}`),
  ),
] as const;

interface PackageJson {
  version: string;
}

function run(command: string, args: string[], cwd: string, env?: NodeJS.ProcessEnv): string {
  const result = spawnSync(command, args, { cwd, env: { ...process.env, ...env }, encoding: "utf8" });
  assert.equal(result.status, 0, [result.error?.message, result.stderr, result.stdout].filter(Boolean).join("\n"));
  return result.stdout.trim();
}

/** Imports the installed package through Node's normal package resolution. */
function validateConsumer(root: string): void {
  const callerRoot = path.join(root, "consumer");
  fs.mkdirSync(callerRoot);
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

  run("node", [consumer], callerRoot, { PLANLOFT_HOME: path.join(root, "consumer-home"), NODE_PATH: "" });

  // The compiler is separate tooling. The consumer resolves types only from the
  // installed tarball and its production dependencies, with no checkout symlinks.
  const tooling = path.join(root, "typescript-tooling");
  fs.mkdirSync(tooling);
  fs.writeFileSync(path.join(tooling, "package.json"), JSON.stringify({ private: true }));
  const typescriptVersion = JSON.parse(fs.readFileSync(path.join(ROOT, "node_modules/typescript/package.json"), "utf8")).version;
  run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", `typescript@${typescriptVersion}`], tooling, installEnvironment(root));
  const typed = path.join(callerRoot, "consumer.tsx");
  fs.writeFileSync(typed, `
import { attachCollaboration, compileMdx, createPlanloftApplication, prepareDocument, type PreparedDocument } from "planloft";
import { Callout, Todo, type TodoProps } from "planloft/components";
const props: TodoProps = { task: "release-check", label: "Installed types" };
const content = <Callout><Todo {...props} /></Callout>;
const app = createPlanloftApplication({ cwd: "." });
const attach: typeof attachCollaboration = async (html, config) => attachCollaboration(html, config);
const prepare: typeof prepareDocument = prepareDocument;
const compile: typeof compileMdx = compileMdx;
const accept = (document: PreparedDocument) => document;
void [content, app, attach, prepare, compile, accept];
`);
  run("node", [path.join(tooling, "node_modules/typescript/bin/tsc"), "--noEmit", "--strict", "--module", "NodeNext", "--moduleResolution", "NodeNext", "--target", "ES2022", "--jsx", "react-jsx", "--skipLibCheck", "false", typed], callerRoot, { NODE_PATH: "" });
}

function installEnvironment(root: string): NodeJS.ProcessEnv {
  return { HOME: path.join(root, "home"), npm_config_userconfig: path.join(root, "npm-user.conf"), npm_config_globalconfig: path.join(root, "npm-global.conf"), npm_config_engine_strict: "true", NODE_PATH: "" };
}

/** Checks package contents, executables, CLI behavior, and Node consumption. */
function validatePackedPackage(tarball: string, minimumNode: boolean): void {
  const runtime = run("node", ["--version"], ROOT);
  const version = /^v(\d+)\.(\d+)\.(\d+)$/.exec(runtime);
  assert.ok(version, `Unrecognized Node version: ${runtime}`);
  const major = Number(version[1]);
  const minor = Number(version[2]);
  assert.ok(major > 22 || (major === 22 && minor >= 15), `Node >=22.15.0 is required; found ${runtime}.`);
  if (minimumNode) assert.equal(runtime, "v22.15.0", `Minimum-runtime verification requires Node v22.15.0 on PATH; found ${runtime}.`);
  console.log(`packed package runtime: ${runtime}${minimumNode ? " (declared minimum)" : " (supported runtime)"}`);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "planloft-packed-package-"));
  try {
    run("tar", ["-xzf", path.resolve(tarball), "-C", root], root);
    const packageRoot = path.join(root, "package");
    for (const required of REQUIRED_FILES) {
      assert.ok(fs.existsSync(path.join(packageRoot, required)), `packed package is missing ${required}`);
    }
    fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ private: true, type: "module" }));
    fs.writeFileSync(path.join(root, "npm-user.conf"), "");
    fs.writeFileSync(path.join(root, "npm-global.conf"), "");
    run("npm", ["install", "--omit=dev", "--no-audit", "--no-fund", path.resolve(tarball)], root, installEnvironment(root));
    assert.equal(fs.lstatSync(path.join(root, "node_modules/planloft")).isSymbolicLink(), false);
    for (const retired of RETIRED_PATHS) {
      assert.ok(!fs.existsSync(path.join(packageRoot, retired)), `packed package contains retired ${retired} assets`);
    }

    const installedRoot = path.join(root, "node_modules", "planloft");
    const cli = path.join(installedRoot, "dist", "cli.js");
    const resolver = path.join(installedRoot, "skills", "planloft-write-doc", "scripts", "resolve-planloft-command.sh");
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
      if (provider !== "local") run("node", ["--input-type=module", "-e", "await import(process.argv[1])", new URL(`file://${path.join(out, entry)}`).href], root, { ...env, TURSO_DATABASE_URL: "https://database.example.test" });
    }
    validateConsumer(root);
    console.log("packed package: isolated production install, files, gallery, attachment, service bundles, CLI, JS and TypeScript consumer PASS");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const args = process.argv.slice(2);
const tarball = args.find(argument => !argument.startsWith("--"));
if (!tarball || args.some(argument => argument !== tarball && argument !== "--minimum-node")) throw new Error("Usage: bun scripts/validate-packed-package.ts <planloft.tgz> [--minimum-node]");
validatePackedPackage(tarball, args.includes("--minimum-node"));
