import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { DEFAULT_CONFIG, saveConfig } from "../core/config.js";
import type { ResolvedContext } from "../core/types.js";
import { resolve } from "./resolve.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("write-direct resolution always returns a Markdown target", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "planloft-resolve-test-"));
  const previousHome = process.env.PLANLOFT_HOME;
  const originalWrite = process.stdout.write;
  let output = "";
  process.env.PLANLOFT_HOME = home;
  process.stdout.write = ((chunk: string | Uint8Array) => {
    output += chunk.toString();
    return true;
  }) as typeof process.stdout.write;

  try {
    saveConfig(DEFAULT_CONFIG);
    resolve({ kind: "plan", slug: "markdown-plan", title: "Markdown Plan" });
    const context = JSON.parse(output) as ResolvedContext;
    assert.equal(context.format, "md");
    assert.match(context.path, /markdown-plan\.md$/);
    assert.match(context.template, /Author Markdown only/);

    output = "";
    resolve({ kind: "review", slug: "markdown-review", title: "Markdown Review" });
    const reviewContext = JSON.parse(output) as ResolvedContext;
    assert.equal(reviewContext.format, "md");
    assert.match(reviewContext.path, /markdown-review\.md$/);
  } finally {
    process.stdout.write = originalWrite;
    if (previousHome === undefined) delete process.env.PLANLOFT_HOME;
    else process.env.PLANLOFT_HOME = previousHome;
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("resolve trims agent metadata while preserving slug synthesis", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "planloft-resolve-metadata-test-"));
  const previousHome = process.env.PLANLOFT_HOME;
  const originalWrite = process.stdout.write;
  let output = "";
  process.env.PLANLOFT_HOME = home;
  process.stdout.write = ((chunk: string | Uint8Array) => {
    output += chunk.toString();
    return true;
  }) as typeof process.stdout.write;

  try {
    saveConfig(DEFAULT_CONFIG);
    resolve({ kind: "  review  ", title: "  Trimmed Title  ", slug: "  Custom Slug  " });
    const context = JSON.parse(output) as ResolvedContext;
    assert.equal(context.kind, "review");
    assert.match(context.path, /custom-slug\.md$/);

    output = "";
    resolve({ kind: "  research note  " });
    const synthesized = JSON.parse(output) as ResolvedContext;
    assert.equal(synthesized.kind, "research note");
    assert.match(synthesized.path, /research-note\.md$/);
  } finally {
    process.stdout.write = originalWrite;
    if (previousHome === undefined) delete process.env.PLANLOFT_HOME;
    else process.env.PLANLOFT_HOME = previousHome;
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("resolve rejects blank and non-string agent metadata", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "planloft-resolve-invalid-metadata-test-"));
  const previousHome = process.env.PLANLOFT_HOME;
  process.env.PLANLOFT_HOME = home;
  try {
    for (const field of ["kind", "title", "slug"] as const) {
      assert.throws(
        () => resolve({ [field]: "   " }),
        new RegExp(`resolve options metadata "${field}" must be a nonblank string`),
      );
      assert.throws(
        () => resolve({ [field]: 42 } as unknown as Parameters<typeof resolve>[0]),
        new RegExp(`resolve options metadata "${field}" must be a nonblank string`),
      );
    }
    assert.equal(fs.existsSync(home), true);
    assert.deepEqual(fs.readdirSync(home), []);
  } finally {
    if (previousHome === undefined) delete process.env.PLANLOFT_HOME;
    else process.env.PLANLOFT_HOME = previousHome;
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("CLI rejects whitespace-only resolve metadata", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "planloft-resolve-cli-metadata-test-"));
  try {
    for (const field of ["kind", "title", "slug"] as const) {
      const result = spawnSync(
        process.execPath,
        ["--import", "tsx", path.join(ROOT, "src/cli.ts"), "resolve", `--${field}`, "   "],
        {
          cwd: ROOT,
          env: { ...process.env, PLANLOFT_HOME: home },
          encoding: "utf8",
        },
      );
      assert.notEqual(result.status, 0);
      assert.match(
        result.stderr,
        new RegExp(`resolve options metadata "${field}" must be a nonblank string`),
      );
    }
    assert.deepEqual(fs.readdirSync(home), []);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("resolve rejects an unusable theme before writing plan or index state", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "planloft-resolve-theme-test-"));
  const previousHome = process.env.PLANLOFT_HOME;
  process.env.PLANLOFT_HOME = home;
  try {
    saveConfig({ ...DEFAULT_CONFIG, theme: "missing-theme" });
    assert.throws(
      () => resolve({ kind: "plan", slug: "never-written", title: "Never Written" }),
      /\[PLANLOFT_THEME_MISSING\]/,
    );
    assert.equal(fs.existsSync(path.join(home, "index.json")), false);
    assert.equal(fs.existsSync(path.join(home, "docs")), false);
  } finally {
    if (previousHome === undefined) delete process.env.PLANLOFT_HOME;
    else process.env.PLANLOFT_HOME = previousHome;
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("resolve validates a theme layout before writing plan or index state", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "planloft-resolve-layout-test-"));
  const previousHome = process.env.PLANLOFT_HOME;
  process.env.PLANLOFT_HOME = home;
  try {
    const theme = path.join(home, "themes", "broken-layout");
    fs.mkdirSync(theme, { recursive: true });
    fs.writeFileSync(path.join(theme, "layout.html"), "<main>{{title}}</main>");
    saveConfig({ ...DEFAULT_CONFIG, theme: "broken-layout" });
    assert.throws(
      () => resolve({ kind: "plan", slug: "never-written", title: "Never Written" }),
      /\[PLANLOFT_THEME_INVALID_LAYOUT\]/,
    );
    assert.equal(fs.existsSync(path.join(home, "index.json")), false);
    assert.equal(fs.existsSync(path.join(home, "docs")), false);
  } finally {
    if (previousHome === undefined) delete process.env.PLANLOFT_HOME;
    else process.env.PLANLOFT_HOME = previousHome;
    fs.rmSync(home, { recursive: true, force: true });
  }
});
