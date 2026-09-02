#!/usr/bin/env bun

import { spawnSync } from "node:child_process";
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

export function compareVersions(left: string, right: string): number {
  const leftParts = parseVersion(left);
  const rightParts = parseVersion(right);
  for (let index = 0; index < leftParts.length; index += 1) {
    const difference = leftParts[index]! - rightParts[index]!;
    if (difference !== 0) return Math.sign(difference);
  }
  return 0;
}

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

function commandResult(command: string, args: string[], env?: NodeJS.ProcessEnv): CommandResult {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
  if (result.error) throw result.error;
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function run(command: string, args: string[], env?: NodeJS.ProcessEnv): void {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdio: "inherit",
  });
  if (result.error || result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status ?? "unknown"}.`);
  }
}

function output(command: string, args: string[]): string {
  const result = commandResult(command, args);
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `${command} ${args.join(" ")} failed.`);
  }
  return result.stdout.trim();
}

function requireCommands(commands: string[]): void {
  const directories = (process.env.PATH ?? "").split(path.delimiter);
  for (const command of commands) {
    const found = directories.some((directory) => {
      try {
        fs.accessSync(path.join(directory, command), fs.constants.X_OK);
        return true;
      } catch {
        return false;
      }
    });
    if (!found) throw new Error(`Missing required command: ${command}.`);
  }
}

function gitStatus(): string[] {
  const result = commandResult("git", ["status", "--porcelain", "--untracked-files=all"]);
  if (result.status !== 0) throw new Error(result.stderr.trim() || "Could not inspect the checkout.");
  return result.stdout
    .trimEnd()
    .split(/\r?\n/)
    .filter(Boolean);
}

function preflightCheckout(): void {
  run("git", ["fetch", "origin", "main", "--tags"]);
  const branch = output("git", ["branch", "--show-current"]);
  if (branch !== "main") throw new Error(`Run releases from main, not ${branch || "detached HEAD"}.`);
  const status = gitStatus();
  if (status.length > 0) throw new Error(`The checkout is not clean:\n${status.join("\n")}`);
  const head = output("git", ["rev-parse", "HEAD"]);
  const remoteHead = output("git", ["rev-parse", "origin/main"]);
  if (head !== remoteHead) throw new Error("main does not match origin/main.");
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

function ensureReleaseChanges(versionChanged: boolean): void {
  const status = gitStatus();
  const expected = versionChanged ? [" M package.json"] : [];
  if (JSON.stringify(status) !== JSON.stringify(expected)) {
    throw new Error(`Release checks changed unexpected files:\n${status.join("\n") || "none"}`);
  }
}

function prepareCandidate(name: string, version: string, versionChanged: boolean): string {
  const candidate = path.join(RELEASE_DIR, `${name}-${version}.tgz`);
  fs.mkdirSync(RELEASE_DIR, { recursive: true });
  fs.rmSync(candidate, { force: true });

  run("bun", ["install", "--frozen-lockfile"]);
  run("bun", ["run", "test"]);
  run("bun", ["run", "typecheck"]);
  run("bun", ["run", "test:public-api"]);
  run("node", ["scripts/installer-matrix.mjs", "--live", "--source", "local", "--workers", "4"]);
  ensureReleaseChanges(versionChanged);

  run("npm", ["pack", "--ignore-scripts", "--pack-destination", RELEASE_DIR]);
  if (!fs.existsSync(candidate)) throw new Error(`npm pack did not create ${candidate}.`);
  run("node", ["scripts/validate-packed-package.mjs", candidate]);
  run("npm", ["publish", "--dry-run", "--access", "public", candidate]);
  ensureReleaseChanges(versionChanged);
  return candidate;
}

function commitAndPush(version: string): string {
  run("git", ["fetch", "origin", "main"]);
  if (output("git", ["rev-parse", "HEAD"]) !== output("git", ["rev-parse", "origin/main"])) {
    throw new Error("origin/main changed while release checks were running. Rebase and rerun the release.");
  }
  ensureReleaseChanges(true);
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
  const localSha = output("shasum", [candidate]).split(/\s+/)[0];
  const registrySha = output("npm", ["view", `${name}@${version}`, "dist.shasum"]);
  if (localSha !== registrySha) throw new Error("The npm tarball does not match the release candidate.");
}

function createAndPushTag(name: string, version: string, commit: string): void {
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
  if (packageAtTag.version !== version) {
    throw new Error(`v${version} points to package version ${packageAtTag.version}.`);
  }
}

function verifyReleasedSkills(version: string): void {
  run("node", [
    "scripts/installer-matrix.mjs",
    "--live",
    "--source",
    "all",
    "--tag",
    `v${version}`,
    "--workers",
    "4",
  ]);
}

async function release(target: string): Promise<void> {
  requireCommands(["git", "node", "npm", "npx", "pnpm", "bun", "bunx", "tar", "shasum"]);
  preflightCheckout();

  const initialPackage = readPackage();
  validateReleaseVersion(initialPackage.version, target);
  const tag = `v${target}`;
  const published = npmVersionExists(initialPackage.name, target);
  const taggedCommit = remoteTagCommit(tag);

  if (published || taggedCommit) {
    if (taggedCommit && !published) {
      throw new Error(`${tag} exists but ${initialPackage.name}@${target} is missing from npm.`);
    }
    if (!taggedCommit) {
      const candidate = path.join(RELEASE_DIR, `${initialPackage.name}-${target}.tgz`);
      const commitFile = `${candidate}.commit`;
      if (!fs.existsSync(candidate) || !fs.existsSync(commitFile)) {
        throw new Error(`npm has ${initialPackage.name}@${target}, but the prepared candidate is missing.`);
      }
      verifyPublishedCandidate(initialPackage.name, target, candidate);
      const commit = fs.readFileSync(commitFile, "utf8").trim();
      verifyTagVersion(commit, target);
      createAndPushTag(initialPackage.name, target, commit);
      verifyReleasedSkills(target);
      console.log(`Recovered ${initialPackage.name}@${target} and pushed ${tag}.`);
      return;
    }
    verifyTagVersion(taggedCommit, target);
    console.log(`${initialPackage.name}@${target} and ${tag} already exist. Verifying released skills.`);
    verifyReleasedSkills(target);
    console.log(`Verified ${initialPackage.name}@${target}.`);
    return;
  }

  run("npm", ["whoami"]);
  const versionChanged = initialPackage.version !== target;
  const originalPackage = fs.readFileSync(PACKAGE_FILE, "utf8");
  if (versionChanged) writePackageVersion(target);

  let candidate: string;
  try {
    candidate = prepareCandidate(initialPackage.name, target, versionChanged);
  } catch (error) {
    if (versionChanged) fs.writeFileSync(PACKAGE_FILE, originalPackage);
    throw error;
  }

  let commit = output("git", ["rev-parse", "HEAD"]);
  if (versionChanged) {
    const beforeCommit = commit;
    try {
      commit = commitAndPush(target);
    } catch (error) {
      if (output("git", ["rev-parse", "HEAD"]) === beforeCommit) {
        fs.writeFileSync(PACKAGE_FILE, originalPackage);
      }
      throw error;
    }
  } else {
    ensureReleaseChanges(false);
  }

  fs.writeFileSync(`${candidate}.commit`, `${commit}\n`);
  run("npm", ["publish", "--access", "public", candidate]);
  await waitForNpm(initialPackage.name, target);
  verifyPublishedCandidate(initialPackage.name, target, candidate);
  createAndPushTag(initialPackage.name, target, commit);
  verifyReleasedSkills(target);
  console.log(`Released ${initialPackage.name}@${target} from ${commit}.`);
}

function printHelp(): void {
  console.log(`Usage: bun run release <version>\n\nExample:\n  bun run release 0.2.5`);
}

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
