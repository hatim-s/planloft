#!/usr/bin/env bun

/**
 * Runs the complete Planloft release from a clean main checkout. The command
 * validates one tarball, pushes its source commit, publishes it, and tags that
 * same commit. Re-running a completed version only verifies the release.
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGE_FILE = path.join(ROOT, "package.json");
const RELEASE_DIR = path.join(ROOT, ".release");
const STABLE_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

interface PackageJson {
  name: string;
  version: string;
  [key: string]: unknown;
}

interface CommandResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

/** Compares two stable semantic versions. */
export function compareVersions(left: string, right: string): number {
  const leftParts = parseVersion(left);
  const rightParts = parseVersion(right);
  for (let index = 0; index < leftParts.length; index += 1) {
    const difference = leftParts[index]! - rightParts[index]!;
    if (difference !== 0) return Math.sign(difference);
  }
  return 0;
}

/** Rejects prereleases, malformed versions, and version downgrades. */
export function validateReleaseVersion(current: string, target: string): void {
  parseVersion(current);
  parseVersion(target);
  if (compareVersions(target, current) < 0) {
    throw new Error(`Release version ${target} is older than package version ${current}.`);
  }
}

function parseVersion(version: string): [number, number, number] {
  const match = STABLE_VERSION.exec(version);
  if (!match) throw new Error(`Expected a stable version such as 0.2.5, received ${version || "nothing"}.`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function readPackage(): PackageJson {
  return JSON.parse(fs.readFileSync(PACKAGE_FILE, "utf8")) as PackageJson;
}

function writePackageVersion(version: string): void {
  const packageJson = readPackage();
  packageJson.version = version;
  fs.writeFileSync(PACKAGE_FILE, `${JSON.stringify(packageJson, null, 2)}\n`);
}

function commandResult(command: string, args: string[]): CommandResult {
  const result = spawnSync(command, args, { cwd: ROOT, encoding: "utf8" });
  if (result.error) throw result.error;
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function run(command: string, args: string[]): void {
  const result = spawnSync(command, args, { cwd: ROOT, stdio: "inherit" });
  if (result.error || result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status ?? "unknown"}.`);
  }
}

function output(command: string, args: string[]): string {
  const result = commandResult(command, args);
  if (result.status !== 0) throw new Error(result.stderr.trim() || `${command} ${args.join(" ")} failed.`);
  return result.stdout.trim();
}

function gitStatus(): string[] {
  const result = commandResult("git", ["status", "--porcelain", "--untracked-files=all"]);
  if (result.status !== 0) throw new Error(result.stderr.trim() || "Could not inspect the checkout.");
  return result.stdout.trimEnd().split(/\r?\n/).filter(Boolean);
}

/** Confirms that the release starts from a clean, synchronized main checkout. */
function validateCheckout(): void {
  run("git", ["fetch", "origin", "main", "--tags"]);
  const branch = output("git", ["branch", "--show-current"]);
  if (branch !== "main") throw new Error(`Run releases from main, not ${branch || "detached HEAD"}.`);
  const status = gitStatus();
  if (status.length > 0) throw new Error(`The checkout is not clean:\n${status.join("\n")}`);
  if (output("git", ["rev-parse", "HEAD"]) !== output("git", ["rev-parse", "origin/main"])) {
    throw new Error("main does not match origin/main.");
  }
}

function npmVersionExists(name: string, version: string): boolean {
  const result = commandResult("npm", ["view", `${name}@${version}`, "version", "--json"]);
  if (result.status === 0) return true;
  if (`${result.stdout}\n${result.stderr}`.includes("E404")) return false;
  throw new Error(result.stderr.trim() || `Could not query ${name}@${version} on npm.`);
}

function remoteTagCommit(tag: string): string | undefined {
  const result = output("git", ["ls-remote", "origin", `refs/tags/${tag}`, `refs/tags/${tag}^{}`]);
  if (!result) return undefined;
  const refs = result.split(/\r?\n/).map((line) => line.split(/\s+/));
  return refs.find(([, ref]) => ref?.endsWith("^{}"))?.[0] ?? refs[0]?.[0];
}

function assertExpectedChanges(versionChanged: boolean): void {
  const status = gitStatus();
  const expected = versionChanged ? [" M package.json"] : [];
  if (JSON.stringify(status) !== JSON.stringify(expected)) {
    throw new Error(`Release checks changed unexpected files:\n${status.join("\n") || "none"}`);
  }
}

/** Runs every reversible check and creates the one tarball used for publication. */
function prepareCandidate(name: string, version: string, versionChanged: boolean): string {
  const candidate = path.join(RELEASE_DIR, `${name}-${version}.tgz`);
  fs.mkdirSync(RELEASE_DIR, { recursive: true });
  fs.rmSync(candidate, { force: true });

  run("bun", ["install", "--frozen-lockfile"]);
  run("bun", ["run", "test"]);
  run("bun", ["run", "typecheck"]);
  run("bun", ["run", "build"]);
  run("bun", ["scripts/validate-public-api.ts"]);
  run("bun", ["scripts/installer-matrix.ts", "--live", "--source", "local", "--workers", "4"]);
  assertExpectedChanges(versionChanged);

  run("npm", ["pack", "--ignore-scripts", "--pack-destination", RELEASE_DIR]);
  if (!fs.existsSync(candidate)) throw new Error(`npm pack did not create ${candidate}.`);
  run("bun", ["scripts/validate-packed-package.ts", candidate]);
  run("npm", ["publish", "--dry-run", "--access", "public", candidate]);
  assertExpectedChanges(versionChanged);
  return candidate;
}

/** Commits only the version bump and pushes it after all reversible checks pass. */
function commitVersion(version: string): string {
  run("git", ["fetch", "origin", "main"]);
  if (output("git", ["rev-parse", "HEAD"]) !== output("git", ["rev-parse", "origin/main"])) {
    throw new Error("origin/main changed while release checks were running. Rebase and rerun the release.");
  }
  assertExpectedChanges(true);
  run("git", ["add", "package.json"]);
  run("git", ["commit", "-m", `Release ${version}`]);
  run("git", ["push", "origin", "main"]);
  return output("git", ["rev-parse", "HEAD"]);
}

async function waitForNpm(name: string, version: string): Promise<void> {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    if (npmVersionExists(name, version)) return;
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
  throw new Error(`${name}@${version} is not visible on npm after 60 seconds.`);
}

function verifyPublishedCandidate(name: string, version: string, candidate: string): void {
  const localSha = createHash("sha1").update(fs.readFileSync(candidate)).digest("hex");
  const registrySha = output("npm", ["view", `${name}@${version}`, "dist.shasum"]);
  if (localSha !== registrySha) throw new Error("The npm tarball does not match the release candidate.");
}

/** Creates the annotated release tag unless the correct tag already exists. */
function createTag(name: string, version: string, commit: string): void {
  const tag = `v${version}`;
  const existing = remoteTagCommit(tag);
  if (existing) {
    if (existing !== commit) throw new Error(`${tag} points to ${existing}, not ${commit}.`);
    return;
  }
  run("git", ["tag", "-a", tag, commit, "-m", `${name} ${tag}`]);
  run("git", ["push", "origin", tag]);
  if (remoteTagCommit(tag) !== commit) throw new Error(`Could not verify ${tag} on GitHub.`);
}

function verifyTagVersion(commit: string, version: string): void {
  const packageAtTag = JSON.parse(output("git", ["show", `${commit}:package.json`])) as PackageJson;
  if (packageAtTag.version !== version) throw new Error(`v${version} points to package version ${packageAtTag.version}.`);
}

function verifyReleasedSkills(version: string): void {
  run("bun", [
    "scripts/installer-matrix.ts",
    "--live",
    "--source",
    "all",
    "--tag",
    `v${version}`,
    "--workers",
    "4",
  ]);
}

/** Handles completed releases and the recoverable npm-published, tag-missing state. */
async function resumeExistingRelease(packageJson: PackageJson, version: string): Promise<boolean> {
  const tag = `v${version}`;
  const published = npmVersionExists(packageJson.name, version);
  const taggedCommit = remoteTagCommit(tag);
  if (!published && !taggedCommit) return false;
  if (taggedCommit && !published) throw new Error(`${tag} exists but ${packageJson.name}@${version} is missing from npm.`);

  if (published && taggedCommit) {
    verifyTagVersion(taggedCommit, version);
    console.log(`${packageJson.name}@${version} and ${tag} already exist. Verifying released skills.`);
    verifyReleasedSkills(version);
    console.log(`Verified ${packageJson.name}@${version}.`);
    return true;
  }

  const candidate = path.join(RELEASE_DIR, `${packageJson.name}-${version}.tgz`);
  const commitFile = `${candidate}.commit`;
  if (!fs.existsSync(candidate) || !fs.existsSync(commitFile)) {
    throw new Error(`npm has ${packageJson.name}@${version}, but the prepared candidate is missing.`);
  }
  verifyPublishedCandidate(packageJson.name, version, candidate);
  const commit = fs.readFileSync(commitFile, "utf8").trim();
  verifyTagVersion(commit, version);
  createTag(packageJson.name, version, commit);
  verifyReleasedSkills(version);
  console.log(`Recovered ${packageJson.name}@${version} and pushed ${tag}.`);
  return true;
}

/** Runs a new release or safely resumes an interrupted one. */
async function release(version: string): Promise<void> {
  validateCheckout();
  const packageJson = readPackage();
  validateReleaseVersion(packageJson.version, version);
  if (await resumeExistingRelease(packageJson, version)) return;

  run("npm", ["whoami"]);
  const versionChanged = packageJson.version !== version;
  const originalPackage = fs.readFileSync(PACKAGE_FILE, "utf8");
  if (versionChanged) writePackageVersion(version);

  let candidate: string;
  try {
    candidate = prepareCandidate(packageJson.name, version, versionChanged);
  } catch (error) {
    if (versionChanged) fs.writeFileSync(PACKAGE_FILE, originalPackage);
    throw error;
  }

  let commit = output("git", ["rev-parse", "HEAD"]);
  if (versionChanged) {
    const previousCommit = commit;
    try {
      commit = commitVersion(version);
    } catch (error) {
      if (output("git", ["rev-parse", "HEAD"]) === previousCommit) fs.writeFileSync(PACKAGE_FILE, originalPackage);
      throw error;
    }
  } else {
    assertExpectedChanges(false);
  }

  fs.writeFileSync(`${candidate}.commit`, `${commit}\n`);
  run("npm", ["publish", "--access", "public", candidate]);
  await waitForNpm(packageJson.name, version);
  verifyPublishedCandidate(packageJson.name, version, candidate);
  createTag(packageJson.name, version, commit);
  verifyReleasedSkills(version);
  console.log(`Released ${packageJson.name}@${version} from ${commit}.`);
}

function printHelp(): void {
  console.log(`Usage: bun run release <version>\n\nExample:\n  bun run release 0.2.5`);
}

/** Parses the release command's single version argument. */
export async function main(argv = process.argv.slice(2)): Promise<void> {
  if (argv.includes("--help") || argv.includes("-h")) {
    printHelp();
    return;
  }
  if (argv.length !== 1) {
    printHelp();
    throw new Error("Pass exactly one stable release version.");
  }
  await release(argv[0]!);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Release failed.");
    process.exitCode = 1;
  });
}
