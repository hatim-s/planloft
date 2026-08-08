import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { hostingDir, templatesDir } from "../core/paths.js";
import type { DeployInput, HostAdapter, Manifest } from "./adapter.js";

const DEFAULT_REPO = "planloft-plans";
const API = "https://api.github.com";

/** Is the `gh` CLI installed + authenticated? (ADR-0001 §D12) */
export function hasGh(): boolean {
  try {
    execFileSync("gh", ["auth", "status"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

async function api(
  token: string,
  method: string,
  pathname: string,
  body?: unknown,
): Promise<Response> {
  return fetch(pathname.startsWith("http") ? pathname : `${API}${pathname}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      "User-Agent": "planloft",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
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
  const res = await api(token, "GET", `/repos/${user}/${repo}`);
  if (res.ok) return;
  if (res.status !== 404) {
    throw new Error(`Cannot read repo ${user}/${repo} (${res.status}).`);
  }
  const create = await api(token, "POST", "/user/repos", {
    name: repo,
    private: false, // GitHub Pages on the free tier needs a public repo (ADR-0001 §D21)
    auto_init: true, // gives us a main branch to clone immediately
    description: "planloft plan/doc deploys",
  });
  if (!create.ok) {
    throw new Error(`Failed to create ${user}/${repo} (${create.status}).`);
  }
}

async function ensurePages(token: string, user: string, repo: string): Promise<string | undefined> {
  const res = await api(token, "POST", `/repos/${user}/${repo}/pages`, {
    source: { branch: "main", path: "/" },
  });
  // 201 created, 409 already enabled — both fine. Anything else: warn, don't fail the deploy.
  if (!res.ok && res.status !== 409) {
    return `Could not auto-enable Pages (${res.status}). Enable it once in repo Settings → Pages (branch: main, /).`;
  }
  return undefined;
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

function writeIfMissing(file: string, contents: string): void {
  if (fs.existsSync(file)) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
}

/** Self-install the scaffold the repo needs: no-jekyll, manifest, prune Action, landing. */
function scaffold(dir: string): void {
  writeIfMissing(path.join(dir, ".nojekyll"), "");
  writeIfMissing(
    path.join(dir, "manifest.json"),
    JSON.stringify({ version: 1, deploys: [] } satisfies Manifest, null, 2) + "\n",
  );

  const tpl = path.join(templatesDir(), "github-pages");
  writeIfMissing(
    path.join(dir, ".github", "workflows", "prune-plans.yml"),
    fs.readFileSync(path.join(tpl, "prune-plans.yml"), "utf8"),
  );
  writeIfMissing(
    path.join(dir, ".planloft", "prune.mjs"),
    fs.readFileSync(path.join(tpl, "prune.mjs"), "utf8"),
  );

  // Bare landing at root — no gallery listing (ADR-0001 §D21).
  writeIfMissing(
    path.join(dir, "index.html"),
    '<!doctype html><meta name="robots" content="noindex, nofollow"><title>planloft</title>\n',
  );
}

// ---- manifest -------------------------------------------------------------

function readManifest(dir: string): Manifest {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8")) as Manifest;
  } catch {
    return { version: 1, deploys: [] };
  }
}

function writeManifest(dir: string, m: Manifest): void {
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(m, null, 2) + "\n");
}

function copyDist(src: string, dest: string): void {
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  fs.cpSync(src, dest, { recursive: true });
}

// ---- adapter --------------------------------------------------------------

export const githubPages: HostAdapter = {
  name: "github-pages",
  basePath(id, cfg) {
    const repo = cfg.github?.repo ?? DEFAULT_REPO;
    return `/${repo}/p/${id}/`;
  },

  async deploy(input: DeployInput) {
    const now = input.now ?? new Date();
    const cfg = input.cfg;
    const repo = cfg.github?.repo ?? DEFAULT_REPO;
    const { user, token } = input.authentication;

    await ensureRepo(token, user, repo);

    const dir = path.join(hostingDir(), repo);
    syncClone(dir, user, repo, token);
    scaffold(dir);

    // Stable id per (project, slug): redeploy reuses the URL and bumps expiry (ADR-0001 §D20).
    const manifest = readManifest(dir);
    const existing = manifest.deploys.find(
      (entry) => entry.project === input.doc.project && entry.slug === input.doc.slug,
    );
    const id = existing?.id ?? input.id;

    copyDist(input.render(id), path.join(dir, "p", id));

    const expiresAt = input.updateManifest(manifest, id);
    writeManifest(dir, manifest);

    // Commit + push (Pages redeploys from the branch).
    git(dir, ["add", "-A"]);
    try {
      git(dir, ["commit", "-m", `planloft: deploy ${input.doc.slug} (${id})`]);
    } catch {
      /* nothing changed */
    }
    authenticatedGit(dir, ["push", "origin", "HEAD:main"], token);

    const pagesWarning = await ensurePages(token, user, repo);

    return {
      url: `https://${user}.github.io/${repo}/p/${id}/`,
      expiresAt,
      ...(pagesWarning ? { warnings: [pagesWarning] } : {}),
    };
  },
};
