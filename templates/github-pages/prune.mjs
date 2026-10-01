// Installed into <user>/planloft-plans by the github-pages adapter (ADR-0001 §D15, §D20).
// Runs daily in CI: delete /p/<id>/ folders past expiresAt, rewrite manifest, commit.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  preparePlanIndexes,
  readManifest,
  writePlanIndexes,
} from "./update-indexes.mjs";

function isNonFastForwardFailure(error) {
  const output = `${String(error?.stderr ?? "")}\n${String(error?.stdout ?? "")}`;
  return /non-fast-forward|fetch first|remote contains work/i.test(output);
}

function pushWithRebase() {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      execFileSync("git", ["push", "origin", "main:main"]);
      return;
    } catch (error) {
      if (attempt === 1 || !isNonFastForwardFailure(error)) throw error;
      execFileSync("git", ["fetch", "origin", "main"]);
      try {
        execFileSync("git", ["rebase", "origin/main"]);
      } catch (rebaseError) {
        try {
          execFileSync("git", ["rebase", "--abort"]);
        } catch {}
        throw rebaseError;
      }
    }
  }
}

function inspectDirectory(directory, name) {
  let stats;
  try {
    stats = fs.lstatSync(directory);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new Error(`${name} must be a directory, not a symbolic link or another file type.`);
  }
  return true;
}

function operationNow() {
  const args = process.argv.slice(2);
  if (args.length === 0) return Date.now();
  if (args.length !== 2 || args[0] !== "--now") {
    throw new Error("planloft-prune accepts only --now <canonical ISO timestamp>.");
  }
  const value = args[1];
  const timestamp = Date.parse(value);
  if (!value || Number.isNaN(timestamp) || new Date(timestamp).toISOString() !== value) {
    throw new Error("--now requires a canonical ISO timestamp.");
  }
  return timestamp;
}

const root = process.cwd();
const branch = execFileSync("git", ["branch", "--show-current"], { encoding: "utf8" }).trim();
if (branch !== "main") throw new Error(`planloft-prune must run on main, not ${branch || "a detached HEAD"}.`);
const manifestPath = path.join(root, "manifest.json");
const manifest = readManifest(root);
const now = operationNow();
const prepared = preparePlanIndexes(root, { now: new Date(now) });

const kept = [];
const expired = [];
for (const entry of manifest.deploys) {
  if (entry.expiresAt !== null && Date.parse(entry.expiresAt) <= now) {
    expired.push(entry);
  } else {
    kept.push(entry);
  }
}

const plansPath = path.join(root, "p");
const existingPlanPaths = new Set();
const plansDirectoryExists = manifest.deploys.length === 0
  ? false
  : inspectDirectory(plansPath, "p");
for (const entry of manifest.deploys) {
  const isExpired = entry.expiresAt !== null && Date.parse(entry.expiresAt) <= now;
  if (!plansDirectoryExists) {
    if (!isExpired) throw new Error(`p/${entry.id} is missing for a live deployment.`);
    continue;
  }
  const planPath = `p/${entry.id}`;
  const planExists = inspectDirectory(path.join(plansPath, entry.id), planPath);
  if (!isExpired && !planExists) throw new Error(`p/${entry.id} is missing for a live deployment.`);
  if (planExists) existingPlanPaths.add(planPath);
}

let removed = 0;
for (const entry of expired) {
  const planPath = path.join(plansPath, entry.id);
  if (existingPlanPaths.has(`p/${entry.id}`)) fs.rmSync(planPath, { recursive: true, force: true });
  removed++;
}
manifest.deploys = kept;
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
writePlanIndexes(root, prepared);

execFileSync("git", ["config", "user.name", "planloft-bot"]);
execFileSync("git", ["config", "user.email", "bot@users.noreply.github.com"]);
const managedPaths = [
  "README.md",
  "index.html",
  "manifest.json",
  ".nojekyll",
  ".github/workflows/prune-plans.yml",
  ".planloft/prune.mjs",
  ".planloft/update-indexes.mjs",
].filter((managedPath) => fs.existsSync(path.join(root, managedPath)));
for (const planPath of existingPlanPaths) managedPaths.push(planPath);
execFileSync("git", ["add", "-f", "-A", "--", ...managedPaths]);
for (const managedPath of managedPaths) {
  if (!managedPath.startsWith("p/")) {
    execFileSync("git", ["ls-files", "--error-unmatch", "--", managedPath]);
  }
}
const stagedChanges = execFileSync("git", ["diff", "--cached", "--name-only"], {
  encoding: "utf8",
}).trim();
if (stagedChanges) {
  const message = removed > 0
    ? `planloft: prune ${removed} expired plan(s)`
    : "planloft: refresh plan indexes";
  execFileSync("git", ["commit", "-m", message]);
  pushWithRebase();
}
console.log(`planloft-prune: removed ${removed}, kept ${kept.length}.`);
