import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { hostingDir } from "../core/paths.js";
import { githubApi, GithubCliApiError, runGhCommand } from "../github-cli.js";
import type { DeployInput } from "./adapter.js";
import { prepareHostingRepository, readManifest, writeManifest } from "./layout.js";

const DEFAULT_REPO = "planloft-plans";

/** Is the `gh` CLI installed + authenticated? (ADR-0001 §D12) */
export function hasGh(): boolean {
  try {
    runGhCommand(["auth", "status"]);
    return true;
  } catch {
    return false;
  }
}

// ---- git helpers ----------------------------------------------------------

function git(cwd: string, args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

export function cleanUrl(user: string, repo: string): string {
  return `https://github.com/${user}/${repo}.git`;
}

type GitRunner = typeof execFileSync;

export function authenticatedGit(
  cwd: string,
  args: string[],
  token: string,
  run: GitRunner = execFileSync,
): void {
  const authDir = fs.mkdtempSync(path.join(os.tmpdir(), "planloft-git-auth-"));
  const askPass = path.join(authDir, "askpass.sh");
  try {
    fs.writeFileSync(
      askPass,
      '#!/bin/sh\ncase "$1" in\n  *Username*) printf \'%s\\n\' "$PLANLOFT_GIT_USERNAME" ;;\n  *) printf \'%s\\n\' "$PLANLOFT_GIT_TOKEN" ;;\nesac\n',
      { mode: 0o700 },
    );
    run("git", ["-C", cwd, ...args], {
      stdio: "ignore",
      env: {
        ...process.env,
        GIT_ASKPASS: askPass,
        GIT_TERMINAL_PROMPT: "0",
        GIT_CONFIG_COUNT: "1",
        GIT_CONFIG_KEY_0: "credential.helper",
        GIT_CONFIG_VALUE_0: "",
        PLANLOFT_GIT_USERNAME: "x-access-token",
        PLANLOFT_GIT_TOKEN: token,
      },
    });
  } catch {
    throw new Error("GitHub Git operation failed. Check credential and repository permissions.");
  } finally {
    fs.rmSync(authDir, { recursive: true, force: true });
  }
}

// ---- repo / pages ---------------------------------------------------------

async function ensureRepo(token: string, user: string, repo: string): Promise<void> {
  try {
    githubApi(token, "GET", `repos/${user}/${repo}`);
    return;
  } catch (error) {
    if (!(error instanceof GithubCliApiError) || error.status !== 404) {
      throw new Error(`Cannot read repo ${user}/${repo}${githubStatusSuffix(error)}.`);
    }
  }
  try {
    githubApi(token, "POST", "user/repos", {
      name: repo,
      private: false, // GitHub Pages on the free tier needs a public repo (ADR-0001 §D21)
      auto_init: true, // gives us a main branch to clone immediately
      description: "planloft plan/doc deploys",
    });
  } catch (error) {
    throw new Error(`Failed to create ${user}/${repo}${githubStatusSuffix(error)}.`);
  }
}

export async function ensurePages(token: string, user: string, repo: string): Promise<string | undefined> {
  try {
    githubApi(token, "POST", `repos/${user}/${repo}/pages`, {
      build_type: "workflow",
    });
    return undefined;
  } catch (error) {
    // 201 created, 409 already enabled. Anything else warns without failing the deploy.
    if (error instanceof GithubCliApiError && error.status === 409) {
      try {
        githubApi(token, "PUT", `repos/${user}/${repo}/pages`, { build_type: "workflow" });
        return undefined;
      } catch (updateError) { error = updateError; }
    }
    const status = error instanceof GithubCliApiError && error.status !== undefined
      ? ` (${error.status})`
      : "";
    return `Could not auto-enable Pages${status}. Choose GitHub Actions in repo Settings → Pages.`;
  }
}

function githubStatusSuffix(error: unknown): string {
  return error instanceof GithubCliApiError && error.status !== undefined
    ? ` (${error.status})`
    : "";
}

// ---- local working clone --------------------------------------------------

export function configureCleanRemote(dir: string, user: string, repo: string): void {
  if (!fs.existsSync(path.join(dir, ".git"))) {
    fs.mkdirSync(dir, { recursive: true });
    git(dir, ["init"]);
  }

  // Rebuild origin so legacy additional fetch URLs and explicit push URLs cannot
  // retain credentials even when the primary fetch URL was already repaired.
  const remotes = execFileSync("git", ["-C", dir, "remote"], { encoding: "utf8" })
    .split(/\r?\n/)
    .filter(Boolean);
  if (remotes.includes("origin")) git(dir, ["remote", "remove", "origin"]);

  const url = cleanUrl(user, repo);
  git(dir, ["remote", "add", "origin", url]);
  git(dir, ["remote", "set-url", "--push", "origin", url]);
}

function syncClone(dir: string, user: string, repo: string, token: string): void {
  configureCleanRemote(dir, user, repo);
  // Remote is source of truth (the prune Action rewrites it) — hard-reset to it.
  authenticatedGit(dir, ["fetch", "--depth", "1", "origin", "main"], token);
  git(dir, ["reset", "--hard", "FETCH_HEAD"]);
  git(dir, ["clean", "-fd"]);
  git(dir, ["config", "user.name", "planloft"]);
  git(dir, ["config", "user.email", `${user}@users.noreply.github.com`]);
}

async function upgradeExistingPages(token: string, user: string, repo: string): Promise<string | undefined> {
  try {
    const site = githubApi<{ build_type?: string }>(token, "GET", `repos/${user}/${repo}/pages`);
    if (site.build_type !== "workflow") githubApi(token, "PUT", `repos/${user}/${repo}/pages`, { build_type: "workflow" });
  } catch (error) {
    if (error instanceof GithubCliApiError && error.status === 404) return undefined;
    return "Could not switch existing GitHub Pages to Actions. Choose GitHub Actions in Settings > Pages.";
  }
  return undefined;
}

export async function publishRepository(input: DeployInput, siteUrl?: string): Promise<{ id: string; dir: string; repo: string; user: string; expiresAt: string; pagesWarning?: string }> {
  const repo = input.cfg.github?.repo ?? DEFAULT_REPO;
  const { user, token } = input.authentication;
  if (!/^[A-Za-z0-9_.-]+$/.test(repo) || repo === "." || repo === "..") {
    throw new Error("PLANLOFT_HOSTING_INVALID: github.repo must be a repository name.");
  }
  await ensureRepo(token, user, repo);
  const dir = path.join(hostingDir(), repo);
  syncClone(dir, user, repo, token);
  prepareHostingRepository(dir);
  const pagesWarning = await upgradeExistingPages(token, user, repo);
  const manifest = readManifest(dir);
  const existing = manifest.deploys.find(entry => entry.project === input.doc.project && entry.slug === input.doc.slug);
  const id = existing?.id ?? input.id;
  if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error("PLANLOFT_HOSTING_INVALID: unsafe publication id.");
  const dest = path.join(dir, "public", "p", id);
  const dist = input.render(id);
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  fs.cpSync(dist, dest, { recursive: true });
  const expiresAt = input.updateManifest(manifest, id);
  writeManifest(dir, manifest);
  const url = siteUrl ?? `https://${user}.github.io/${repo}`;
  fs.writeFileSync(path.join(dir, ".planloft", "site.json"), JSON.stringify({ url }) + "\n");
  const generator = path.join(dir, ".planloft", "update-indexes.mjs");
  if (fs.existsSync(generator)) execFileSync(process.execPath, [generator, "--pages-base-url", url], { cwd: dir, stdio: "ignore" });
  git(dir, ["add", "-A"]);
  const changes = execFileSync("git", ["diff", "--cached", "--name-only"], { cwd: dir, encoding: "utf8" });
  if (changes.trim()) git(dir, ["commit", "-m", `planloft: deploy ${input.doc.slug} (${id})`]);
  authenticatedGit(dir, ["push", "origin", "HEAD:main"], token);
  return { id, dir, repo, user, expiresAt, pagesWarning };
}
