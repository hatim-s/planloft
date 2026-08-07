import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { projectKey } from "../core/project.js";
import { upsertDoc } from "../core/store.js";
import type { DocMeta } from "../core/types.js";
import { copy } from "./copy.js";

test("copy writes exact source at the Git root from root and nested directories", () => {
  withHome((home) => {
    const repo = path.join(home, "repo");
    const nested = path.join(repo, "packages", "app");
    makeGitRepo(repo, "https://github.com/example/root-copy.git");
    fs.mkdirSync(nested, { recursive: true });
    const source = registerSource(home, repo, "root-plan", Buffer.from("---\r\ntitle: Exact\r\n---\r\n\r\n# Exact\r\n"));

    copy("root-plan", { cwd: repo });
    const destination = path.join(repo, ".planloft", "plans", "root-plan.md");
    assert.deepEqual(fs.readFileSync(destination), fs.readFileSync(source));

    fs.rmSync(destination);
    copy("root-plan", { cwd: nested });
    assert.deepEqual(fs.readFileSync(destination), fs.readFileSync(source));
    assert.equal(fs.existsSync(path.join(nested, ".planloft")), false);
  });
});

test("copy uses each linked worktree root", () => {
  withHome((home) => {
    const repo = path.join(home, "repo");
    const worktree = path.join(home, "repo-worktree");
    makeGitRepo(repo, "https://github.com/example/worktree-copy.git");
    fs.writeFileSync(path.join(repo, "README.md"), "root\n");
    git(repo, ["add", "README.md"]);
    git(repo, ["-c", "user.name=Planloft Test", "-c", "user.email=planloft@example.com", "commit", "-m", "initial"]);
    git(repo, ["worktree", "add", "-b", "copy-worktree", worktree]);
    fs.mkdirSync(path.join(worktree, "docs"));
    const source = registerSource(home, worktree, "worktree-plan", Buffer.from("# Worktree\n"));

    copy("worktree-plan", { cwd: path.join(worktree, "docs") });
    assert.deepEqual(
      fs.readFileSync(path.join(worktree, ".planloft", "plans", "worktree-plan.md")),
      fs.readFileSync(source),
    );
    assert.equal(fs.existsSync(path.join(repo, ".planloft", "plans", "worktree-plan.md")), false);
  });
});

test("copy works in a repository without an origin remote", () => {
  withHome((home) => {
    const repo = path.join(home, "local-repo");
    makeGitRepo(repo);
    const source = registerSource(home, repo, "local-plan", Buffer.from("# Local\n"));

    copy("local-plan", { cwd: repo });
    assert.deepEqual(
      fs.readFileSync(path.join(repo, ".planloft", "plans", "local-plan.md")),
      fs.readFileSync(source),
    );
  });
});

test("copy falls back outside Git, prints a notice, and requires force to overwrite", () => {
  withHome((home) => {
    const directory = path.join(home, "not-git");
    fs.mkdirSync(directory);
    const source = registerSource(home, directory, "fallback-plan", Buffer.from("# Original\n"));

    const first = captureOutput(() => copy("fallback-plan", { cwd: directory }));
    const destination = path.join(directory, ".planloft", "plans", "fallback-plan.md");
    assert.match(first.stdout, /Not in a Git repository; using the current directory/);
    assert.deepEqual(fs.readFileSync(destination), fs.readFileSync(source));

    fs.writeFileSync(destination, "local edit\n");
    const refused = captureOutput(() => copy("fallback-plan", { cwd: directory }));
    assert.match(refused.stderr, /Refusing to overwrite .*--force/);
    assert.equal(fs.readFileSync(destination, "utf8"), "local edit\n");
    assert.equal(refused.exitCode, 1);

    const replaced = captureOutput(() => copy("fallback-plan", { cwd: directory, force: true }));
    assert.equal(replaced.exitCode, undefined);
    assert.deepEqual(fs.readFileSync(destination), fs.readFileSync(source));
  });
});

function withHome(run: (home: string) => void): void {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "planloft-copy-test-"));
  const previousHome = process.env.PLANLOFT_HOME;
  const previousExitCode = process.exitCode;
  process.env.PLANLOFT_HOME = home;
  process.exitCode = undefined;
  try {
    run(home);
  } finally {
    if (previousHome === undefined) delete process.env.PLANLOFT_HOME;
    else process.env.PLANLOFT_HOME = previousHome;
    process.exitCode = previousExitCode;
    fs.rmSync(home, { recursive: true, force: true });
  }
}

function makeGitRepo(directory: string, origin?: string): void {
  fs.mkdirSync(directory, { recursive: true });
  git(directory, ["init"]);
  if (origin) git(directory, ["remote", "add", "origin", origin]);
}

function git(cwd: string, args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

function registerSource(home: string, cwd: string, slug: string, source: Buffer): string {
  const file = path.join(home, "sources", `${slug}.md`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, source);
  const identity = projectKey(cwd);
  const meta: DocMeta = {
    slug,
    title: slug,
    kind: "plan",
    project: identity.key,
    status: "active",
    format: "md",
    file,
    updatedAt: new Date().toISOString(),
  };
  upsertDoc(identity.key, identity.label, meta);
  return file;
}

function captureOutput(run: () => void): { stdout: string; stderr: string; exitCode: number | undefined } {
  const originalLog = console.log;
  const originalError = console.error;
  const previousExitCode = process.exitCode;
  let stdout = "";
  let stderr = "";
  process.exitCode = undefined;
  console.log = (...values: unknown[]) => {
    stdout += values.join(" ") + "\n";
  };
  console.error = (...values: unknown[]) => {
    stderr += values.join(" ") + "\n";
  };
  try {
    run();
    return { stdout, stderr, exitCode: process.exitCode };
  } finally {
    console.log = originalLog;
    console.error = originalError;
    process.exitCode = previousExitCode;
  }
}
