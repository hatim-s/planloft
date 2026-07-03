import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";

// Project identity (ADR-0001 §D4): normalized git remote, fallback path-hash.

function git(args: string[], cwd: string): string | null {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

export function gitRoot(cwd = process.cwd()): string | null {
  return git(["rev-parse", "--show-toplevel"], cwd);
}

/** git@github.com:you/repo.git | https://github.com/you/repo.git -> github.com/you/repo */
export function normalizeRemote(url: string): string {
  return url
    .replace(/^git@([^:]+):/, "$1/")
    .replace(/^ssh:\/\/git@/, "")
    .replace(/^https?:\/\//, "")
    .replace(/\.git$/, "")
    .replace(/\/$/, "");
}

export function gitRemote(cwd = process.cwd()): string | null {
  const url = git(["remote", "get-url", "origin"], cwd);
  return url ? normalizeRemote(url) : null;
}

/** Resolve the canonical project key + a human folder label for `cwd`. */
export function projectKey(cwd = process.cwd()): { key: string; label: string } {
  const remote = gitRemote(cwd);
  if (remote) return { key: remote, label: remote.split("/").pop() || remote };

  const root = gitRoot(cwd) ?? cwd;
  const hash = createHash("sha256").update(root).digest("hex").slice(0, 6);
  return { key: `path-${hash}`, label: `${path.basename(root)}-${hash}` };
}
