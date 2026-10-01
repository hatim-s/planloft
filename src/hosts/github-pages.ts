import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { hostingDir, templatesDir } from "../core/paths.js";
import { githubApi, GithubCliApiError, runGhCommand } from "../github-cli.js";
import type { DeployInput, HostAdapter, Manifest } from "./adapter.js";

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

class GitOperationError extends Error {
  constructor(readonly operationError: unknown) {
    super("GitHub Git operation failed. Check credential and repository permissions.");
    this.name = "GitOperationError";
  }
}

function gitErrorText(error: unknown): string {
  if (error instanceof GitOperationError) return gitErrorText(error.operationError);
  if (typeof error !== "object" || error === null) return "";
  const values: string[] = [];
  for (const property of ["message", "stderr", "stdout"] as const) {
    const descriptor = Object.getOwnPropertyDescriptor(error, property);
    if (!descriptor || !("value" in descriptor)) continue;
    if (typeof descriptor.value === "string") values.push(descriptor.value);
    else if (Buffer.isBuffer(descriptor.value)) values.push(descriptor.value.toString("utf8"));
  }
  return values.join("\n");
}

function isNonFastForward(error: unknown): boolean {
  return /\bnon-fast-forward\b|\(fetch first\)|remote contains work that you (?:do not|don't) have locally/i
    .test(gitErrorText(error));
}

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
      stdio: ["ignore", "pipe", "pipe"],
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
  } catch (error) {
    throw new GitOperationError(error);
  } finally {
    fs.rmSync(authDir, { recursive: true, force: true });
  }
}

function fetchFullMain(dir: string, token: string): void {
  const shallow = execFileSync("git", ["rev-parse", "--is-shallow-repository"], {
    cwd: dir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim() === "true";
  const args = ["fetch"];
  if (shallow) args.push("--unshallow");
  args.push("origin", "main");
  authenticatedGit(dir, args, token);
}

function pushMain(dir: string, token: string): void {
  const push = ["push", "--porcelain", "origin", "HEAD:main"];
  try {
    authenticatedGit(dir, push, token);
  } catch (error) {
    if (!isNonFastForward(error)) throw error;
    fetchFullMain(dir, token);
    try {
      git(dir, ["rebase", "FETCH_HEAD"]);
    } catch (rebaseError) {
      try {
        git(dir, ["rebase", "--abort"]);
      } catch {}
      throw rebaseError;
    }
    authenticatedGit(dir, push, token);
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

async function ensurePages(token: string, user: string, repo: string): Promise<void> {
  try {
    await githubApi(token, "POST", `repos/${user}/${repo}/pages`, {
      source: { branch: "main", path: "/" },
    });
    return;
  } catch (error) {
    if (!(error instanceof GithubCliApiError) || error.status !== 409) {
      throw new Error(
        `Failed to configure GitHub Pages${githubStatusSuffix(error)}. Check repository permissions and network access.`,
      );
    }
  }

  let pages: unknown;
  try {
    pages = await githubApi<unknown>(token, "GET", `repos/${user}/${repo}/pages`);
  } catch (error) {
    throw new Error(
      `Failed to read the GitHub Pages source${githubStatusSuffix(error)}. Check repository permissions and network access.`,
    );
  }
  const sourceError = pagesSourceWarning(pages);
  if (sourceError) throw new Error(sourceError);
}

export function pagesSourceWarning(pages: unknown): string | undefined {
  if (!isRecord(pages)) {
    return "GitHub Pages returned an unreadable source configuration. Set it to branch main, path /.";
  }
  const source = isRecord(pages.source) ? pages.source : undefined;
  const branch = source?.branch;
  const directory = source?.path;
  if (pages.build_type === "legacy" && branch === "main" && directory === "/") return undefined;
  const buildType = pages.build_type === "workflow" ? "an Actions build" : "an unsupported build type";
  const details = pages.build_type === "legacy" && typeof branch === "string" && typeof directory === "string"
    ? `branch ${branch}, path ${directory}`
    : buildType;
  return `GitHub Pages uses ${details}, not legacy branch main, path /. The plan index and returned plan URL will not be served until the source is updated.`;
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
  fetchFullMain(dir, token);
  git(dir, ["reset", "--hard", "FETCH_HEAD"]);
  git(dir, ["clean", "-fd"]);
  git(dir, ["config", "user.name", "planloft"]);
  git(dir, ["config", "user.email", `${user}@users.noreply.github.com`]);
}

function filesystemCode(error: unknown): string | undefined {
  return error && typeof error === "object" && "code" in error
    ? String(error.code)
    : undefined;
}

function managedFileExists(file: string, label: string): boolean {
  let stats: fs.Stats;
  try {
    stats = fs.lstatSync(file);
  } catch (error) {
    if (filesystemCode(error) === "ENOENT") return false;
    throw error;
  }
  if (stats.isSymbolicLink()) throw new Error(`${label} must not be a symbolic link.`);
  if (!stats.isFile()) throw new Error(`${label} must be a regular file.`);
  return true;
}

function writeManagedFile(file: string, label: string, contents: string): void {
  const exists = managedFileExists(file, label);
  if (exists) return;
  const noFollow = fs.constants.O_NOFOLLOW ?? 0;
  const descriptor = fs.openSync(
    file,
    fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | noFollow,
  );
  try {
    fs.writeFileSync(descriptor, contents, { encoding: "utf8" });
  } finally {
    fs.closeSync(descriptor);
  }
}

function overwriteManagedFile(file: string, label: string, contents: string): void {
  managedFileExists(file, label);
  const noFollow = fs.constants.O_NOFOLLOW ?? 0;
  const descriptor = fs.openSync(
    file,
    fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_TRUNC | noFollow,
  );
  try {
    if (!fs.fstatSync(descriptor).isFile()) throw new Error(`${label} must be a regular file.`);
    fs.writeFileSync(descriptor, contents, { encoding: "utf8" });
  } finally {
    fs.closeSync(descriptor);
  }
}

/** Self-install the scaffold the repo needs: no-jekyll, manifest, prune Action, indexes. */
function scaffold(dir: string): void {
  writeManagedFile(path.join(dir, ".nojekyll"), ".nojekyll", "");
  writeManagedFile(
    path.join(dir, "manifest.json"),
    "manifest.json",
    JSON.stringify({ version: 1, deploys: [] } satisfies Manifest, null, 2) + "\n",
  );

  const tpl = path.join(templatesDir(), "github-pages");
  const githubDir = path.join(dir, ".github");
  const workflowsDir = path.join(githubDir, "workflows");
  ensureRealDirectory(githubDir, ".github");
  ensureRealDirectory(workflowsDir, ".github/workflows");
  overwriteManagedFile(
    path.join(workflowsDir, "prune-plans.yml"),
    ".github/workflows/prune-plans.yml",
    fs.readFileSync(path.join(tpl, "prune-plans.yml"), "utf8"),
  );
  const planloftDir = path.join(dir, ".planloft");
  ensureRealDirectory(planloftDir, ".planloft");
  overwriteManagedFile(
    path.join(planloftDir, "prune.mjs"),
    ".planloft/prune.mjs",
    fs.readFileSync(path.join(tpl, "prune.mjs"), "utf8"),
  );
  overwriteManagedFile(
    path.join(planloftDir, "update-indexes.mjs"),
    ".planloft/update-indexes.mjs",
    fs.readFileSync(path.join(tpl, "update-indexes.mjs"), "utf8"),
  );
}

function updatePlanIndexes(dir: string, pagesBaseUrl: string, now: string): void {
  execFileSync(
    process.execPath,
    [
      path.join(dir, ".planloft", "update-indexes.mjs"),
      "--pages-base-url",
      pagesBaseUrl,
      "--now",
      now,
    ],
    { cwd: dir, stdio: "ignore" },
  );
}

// ---- manifest -------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonemptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isSafeManifestId(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9_-]+$/.test(value);
}

function isCanonicalIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const timestamp = Date.parse(value);
  return !Number.isNaN(timestamp) && new Date(timestamp).toISOString() === value;
}

function isManifest(value: unknown): value is Manifest {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.deploys)) return false;
  const ids = new Set<string>();
  for (const entry of value.deploys) {
    if (!isRecord(entry)) return false;
    if (!isSafeManifestId(entry.id)) return false;
    if (ids.has(entry.id)) return false;
    ids.add(entry.id);
    if (
      !isNonemptyString(entry.project) ||
      !isNonemptyString(entry.slug) ||
      !isNonemptyString(entry.title) ||
      !isNonemptyString(entry.kind) ||
      !isCanonicalIsoTimestamp(entry.createdAt) ||
      (entry.expiresAt !== null && !isCanonicalIsoTimestamp(entry.expiresAt))
    ) return false;
  }
  return true;
}

function readManifest(dir: string): Manifest {
  const manifestPath = path.join(dir, "manifest.json");
  let linkStats: fs.Stats;
  try {
    linkStats = fs.lstatSync(manifestPath);
  } catch {
    throw new Error("Cannot deploy because the planloft-plans manifest is invalid.");
  }
  if (linkStats.isSymbolicLink()) {
    throw new Error("Cannot deploy because manifest.json is a symbolic link.");
  }
  if (!linkStats.isFile()) {
    throw new Error("Cannot deploy because manifest.json is not a regular file.");
  }

  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(
      manifestPath,
      fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW,
    );
    if (!fs.fstatSync(descriptor).isFile()) {
      throw new Error("manifest.json is not a regular file");
    }
    const value: unknown = JSON.parse(fs.readFileSync(descriptor, "utf8"));
    if (!isManifest(value)) throw new Error("manifest.json is invalid");
    return value;
  } catch {
    throw new Error("Cannot deploy because the planloft-plans manifest is invalid.");
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function writeManifest(dir: string, m: Manifest): void {
  overwriteManagedFile(
    path.join(dir, "manifest.json"),
    "manifest.json",
    JSON.stringify(m, null, 2) + "\n",
  );
}

function requireRealDirectory(directory: string, label: string): void {
  if (!fs.lstatSync(directory).isDirectory()) {
    throw new Error(`${label} must be a real directory, not a symbolic link or other file.`);
  }
}

function ensureRealDirectory(directory: string, label: string): void {
  try {
    fs.mkdirSync(directory);
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "EEXIST") {
      throw error;
    }
  }
  requireRealDirectory(directory, label);
}

function copyDist(src: string, dest: string): void {
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  fs.cpSync(src, dest, { recursive: true });
}

function liveDeploymentIds(manifest: Manifest, now: Date): string[] {
  return manifest.deploys
    .filter((entry) => entry.expiresAt === null || Date.parse(entry.expiresAt) > now.getTime())
    .map((entry) => entry.id);
}

function stageManagedDeployment(dir: string, liveIds: string[]): string[] {
  const managedPaths = [
    "README.md",
    "index.html",
    "manifest.json",
    ".nojekyll",
    ".github/workflows/prune-plans.yml",
    ".planloft/prune.mjs",
    ".planloft/update-indexes.mjs",
    ...liveIds.map((id) => `p/${id}`),
  ];
  git(dir, ["add", "-f", "--", ...managedPaths]);
  return managedPaths;
}

function verifyTracked(dir: string, managedPaths: string[]): void {
  for (const managedPath of managedPaths) {
    git(dir, ["ls-files", "--error-unmatch", "--", managedPath]);
  }
}

// ---- adapter --------------------------------------------------------------

export const githubPages: HostAdapter = {
  name: "github-pages",
  basePath(id, cfg) {
    const repo = cfg.github?.repo ?? DEFAULT_REPO;
    return `/${repo}/p/${id}/`;
  },

  async deploy(input: DeployInput) {
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
    if (!isSafeManifestId(id)) {
      throw new Error("Cannot deploy because the deployment id is invalid.");
    }

    const plansDirectory = path.join(dir, "p");
    const deploymentDirectory = path.join(plansDirectory, id);
    ensureRealDirectory(plansDirectory, "p");
    for (const entry of manifest.deploys) {
      const live = entry.expiresAt === null || Date.parse(entry.expiresAt) > input.now.getTime();
      if (live && entry.id !== id) {
        requireRealDirectory(path.join(plansDirectory, entry.id), `p/${entry.id}`);
      }
    }
    ensureRealDirectory(deploymentDirectory, `p/${id}`);
    copyDist(input.render(id), deploymentDirectory);

    const expiresAt = input.updateManifest(manifest, id);
    const liveIds = liveDeploymentIds(manifest, input.now);
    for (const liveId of liveIds) {
      requireRealDirectory(path.join(plansDirectory, liveId), `p/${liveId}`);
    }
    writeManifest(dir, manifest);
    updatePlanIndexes(dir, `https://${user}.github.io/${repo}`, input.now.toISOString());
    await ensurePages(token, user, repo);

    // Commit + push (Pages redeploys from the branch).
    const managedPaths = stageManagedDeployment(dir, liveIds);
    const changes = execFileSync("git", ["diff", "--cached", "--name-only"], {
      cwd: dir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (changes) {
      git(dir, ["commit", "-m", `planloft: deploy ${input.doc.slug} (${id})`]);
    }
    verifyTracked(dir, managedPaths);
    pushMain(dir, token);

    return {
      url: `https://${user}.github.io/${repo}/p/${id}/`,
      expiresAt,
    };
  },
};
