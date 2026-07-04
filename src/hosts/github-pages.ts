import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "../core/config.js";
import { hostingDir, templatesDir } from "../core/paths.js";
import type { DeployInput, HostAdapter } from "./adapter.js";

const DEFAULT_REPO = "planloft-plans";
const API = "https://api.github.com";

interface ManifestEntry {
  id: string;
  project: string;
  slug: string;
  title: string;
  kind: string;
  createdAt: string;
  expiresAt: string | null; // null = permanent
}
interface Manifest {
  version: 1;
  deploys: ManifestEntry[];
}

/** Is the `gh` CLI installed + authenticated? (ADR-0001 §D12) */
export function hasGh(): boolean {
  try {
    execFileSync("gh", ["auth", "status"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

// ---- auth -----------------------------------------------------------------

/** Token from `gh auth token`, falling back to a configured PAT (ADR-0001 §D12). */
function discoverToken(): string {
  let ghToken: string | null = null;
  try {
    ghToken = execFileSync("gh", ["auth", "token"], { encoding: "utf8" }).trim();
  } catch {
    ghToken = null;
  }
  const token = ghToken || loadConfig().github?.token;
  if (!token) {
    throw new Error(
      "GitHub auth not found. Run `gh auth login`, or set github.token (a PAT with repo scope) " +
        "via `planloft config`.",
    );
  }
  return token;
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

async function login(token: string): Promise<string> {
  const cfgUser = loadConfig().github?.user;
  const res = await api(token, "GET", "/user");
  if (!res.ok) {
    if (cfgUser) return cfgUser;
    throw new Error(`GitHub /user failed (${res.status}). Check your token/PAT scope.`);
  }
  return ((await res.json()) as { login: string }).login;
}

// ---- git helpers ----------------------------------------------------------

function git(cwd: string, args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

// Token embedded in the URL for a single command; never persisted to .git/config.
function authUrl(user: string, repo: string, token: string): string {
  return `https://x-access-token:${token}@github.com/${user}/${repo}.git`;
}
function cleanUrl(user: string, repo: string): string {
  return `https://github.com/${user}/${repo}.git`;
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

async function ensurePages(token: string, user: string, repo: string): Promise<void> {
  const res = await api(token, "POST", `/repos/${user}/${repo}/pages`, {
    source: { branch: "main", path: "/" },
  });
  // 201 created, 409 already enabled — both fine. Anything else: warn, don't fail the deploy.
  if (!res.ok && res.status !== 409) {
    console.warn(
      `planloft: could not auto-enable Pages (${res.status}). Enable it once in repo Settings → Pages (branch: main, /).`,
    );
  }
}

// ---- local working clone --------------------------------------------------

function syncClone(dir: string, user: string, repo: string, token: string): void {
  const auth = authUrl(user, repo, token);
  if (!fs.existsSync(path.join(dir, ".git"))) {
    fs.mkdirSync(hostingDir(), { recursive: true });
    execFileSync("git", ["clone", "--depth", "1", auth, dir], { stdio: "ignore" });
    git(dir, ["remote", "set-url", "origin", cleanUrl(user, repo)]); // drop token from config
  } else {
    // Remote is source of truth (the prune Action rewrites it) — hard-reset to it.
    execFileSync("git", ["-C", dir, "fetch", "--depth", "1", auth, "main"], { stdio: "ignore" });
    git(dir, ["reset", "--hard", "FETCH_HEAD"]);
    git(dir, ["clean", "-fd"]);
  }
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
  basePath(id) {
    const cfg = loadConfig();
    const repo = cfg.github?.repo ?? DEFAULT_REPO;
    return `/${repo}/p/${id}/`;
  },

  async deploy(input: DeployInput): Promise<string> {
    const cfg = loadConfig();
    const repo = cfg.github?.repo ?? DEFAULT_REPO;
    const token = discoverToken();
    const user = await login(token);

    await ensureRepo(token, user, repo);

    const dir = path.join(hostingDir(), repo);
    syncClone(dir, user, repo, token);
    scaffold(dir);

    // Stable id per (project, slug): redeploy reuses the URL and bumps expiry (ADR-0001 §D20).
    const manifest = readManifest(dir);
    const existing = manifest.deploys.find(
      (d) => d.project === input.doc.project && d.slug === input.doc.slug,
    );
    const id = existing?.id ?? input.id;

    copyDist(input.dist, path.join(dir, "p", id));

    const now = new Date().toISOString();
    const expiresAt = input.ttlDays
      ? new Date(Date.now() + input.ttlDays * 86_400_000).toISOString()
      : null;
    manifest.deploys = manifest.deploys.filter((d) => d.id !== id);
    manifest.deploys.push({
      id,
      project: input.doc.project,
      slug: input.doc.slug,
      title: input.doc.title,
      kind: input.doc.kind,
      createdAt: existing?.createdAt ?? now,
      expiresAt,
    });
    writeManifest(dir, manifest);

    // Commit + push (Pages redeploys from the branch).
    git(dir, ["add", "-A"]);
    try {
      git(dir, ["commit", "-m", `planloft: deploy ${input.doc.slug} (${id})`]);
    } catch {
      /* nothing changed */
    }
    execFileSync("git", ["-C", dir, "push", authUrl(user, repo, token), "HEAD:main"], {
      stdio: "ignore",
    });

    await ensurePages(token, user, repo);

    return `https://${user}.github.io/${repo}/p/${id}/`;
  },
};
