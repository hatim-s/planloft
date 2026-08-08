import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createPlanloftApplication } from "./application.js";

test("copy writes exact source at a Git root from root and nested cwd", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "planloft-copy-test-"));
  const home = path.join(root, "home");
  const repo = path.join(root, "repo");
  const nested = path.join(repo, "packages", "app");
  fs.mkdirSync(nested, { recursive: true });
  execFileSync("git", ["init"], { cwd: repo, stdio: "ignore" });
  execFileSync("git", ["remote", "add", "origin", "https://github.com/example/copy-test.git"], {
    cwd: repo,
  });
  const source = path.join(root, "exact.md");
  fs.writeFileSync(source, "---\r\ntitle: Exact\r\n---\r\n\r\n# Exact\r\n");

  try {
    const rootApplication = createPlanloftApplication({ cwd: repo, planloftHome: home });
    const hoisted = await rootApplication.hoist(source, { slug: "exact" });
    const first = await rootApplication.copy("exact");
    assert.equal(first.usedCurrentDirectory, false);
    assert.deepEqual(fs.readFileSync(first.path), fs.readFileSync(hoisted.document.file));

    fs.rmSync(first.path);
    const nestedApplication = createPlanloftApplication({ cwd: nested, planloftHome: home });
    const second = await nestedApplication.copy("exact");
    assert.equal(second.path, path.join(fs.realpathSync(repo), ".planloft", "plans", "exact.md"));
    assert.deepEqual(fs.readFileSync(second.path), fs.readFileSync(hoisted.document.file));
    assert.equal(fs.existsSync(path.join(nested, ".planloft")), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("copy reports the cwd fallback outside Git and requires force to replace", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "planloft-copy-fallback-test-"));
  const home = path.join(root, "home");
  const cwd = path.join(root, "directory");
  const source = path.join(root, "fallback.md");
  fs.mkdirSync(cwd);
  fs.writeFileSync(source, "# Original\n");
  const application = createPlanloftApplication({ cwd, planloftHome: home });

  try {
    await application.hoist(source, { slug: "fallback" });
    const first = await application.copy("fallback");
    assert.equal(first.usedCurrentDirectory, true);
    fs.writeFileSync(first.path, "local edit\n");
    await assert.rejects(application.copy("fallback"), /PLANLOFT_COPY_CONFLICT/);
    assert.equal(fs.readFileSync(first.path, "utf8"), "local edit\n");
    const replaced = await application.copy("fallback", { force: true });
    assert.equal(replaced.replaced, true);
    assert.equal(fs.readFileSync(replaced.path, "utf8").includes("# Original"), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
