import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createPlanloftApplication, PlanloftApplicationError } from "./application.js";
import { DEFAULT_CONFIG, saveConfig } from "./configuration.js";
import { withPlanloftHome } from "./core/paths.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const TS_LOADER = process.versions.bun ? [] : ["--import", "tsx"];

test("application resolution returns a theme and selected format and normalizes agent metadata", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "planloft-resolve-test-"));
  try {
    const application = createPlanloftApplication({ cwd: root, planloftHome: path.join(root, "home") });
    const plan = await application.resolve({
      kind: "plan",
      slug: "markdown-plan",
      title: "Markdown Plan",
    });
    assert.equal(plan.context.format, "md");
    assert.match(plan.context.path, /markdown-plan\.md$/);
    assert.match(plan.context.themeCss, /:root/);
    assert.match(plan.context.themePath, /style\.css$/);

    const review = await application.resolve({
      format: "mdx",
      kind: "  review  ",
      title: "  Trimmed Title  ",
      slug: "  Custom Slug  ",
    });
    assert.equal(review.context.kind, "review");
    assert.match(review.context.path, /custom-slug\.mdx$/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("application resolution rejects invalid metadata and theme before writes", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "planloft-resolve-validation-test-"));
  const home = path.join(root, "home");
  const application = createPlanloftApplication({ cwd: root, planloftHome: home });
  try {
    await assert.rejects(application.resolve({ title: "   " }), (error: unknown) => {
      assert.ok(error instanceof PlanloftApplicationError);
      assert.equal(error.category, "validation");
      assert.match(error.message, /metadata "title" must be a nonblank string/);
      return true;
    });
    assert.equal(fs.existsSync(home), false);

    withPlanloftHome(home, () => saveConfig({ ...DEFAULT_CONFIG, theme: "missing-theme" }));
    await assert.rejects(
      application.resolve({ slug: "never-written", title: "Never Written" }),
      /PLANLOFT_THEME_MISSING/,
    );
    assert.equal(fs.existsSync(path.join(home, "index.json")), false);
    assert.equal(fs.existsSync(path.join(home, "docs")), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("resolve rejects unsupported format with resolve-specific guidance", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "planloft-resolve-format-"));
  try {
    const result = spawnSync(process.execPath, [...TS_LOADER, path.join(ROOT, "src/cli.ts"), "resolve", "--format", "json"],
      { cwd: ROOT, env: { ...process.env, PLANLOFT_HOME: path.join(root, "home") }, encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /PLANLOFT_RESOLVE_FORMAT_INVALID.*Use md, mdx, or html/);
    assert.doesNotMatch(result.stderr, /stdin|Use md, mdx, json/);
    assert.equal(fs.existsSync(path.join(root, "home")), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("CLI adapter maps application validation failures to stderr and exit code", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "planloft-resolve-cli-test-"));
  try {
    const result = spawnSync(
      process.execPath,
      [...TS_LOADER, path.join(ROOT, "src/cli.ts"), "resolve", "--title", "   "],
      { cwd: ROOT, env: { ...process.env, PLANLOFT_HOME: home }, encoding: "utf8" },
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Resolve failed: .*metadata "title" must be a nonblank string/);
    assert.deepEqual(fs.readdirSync(home), []);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
