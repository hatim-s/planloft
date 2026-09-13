#!/usr/bin/env bun

/**
 * Verifies that the two shipped skills survive the add, list, update, remove, and
 * reinstall lifecycle across a small set of representative installer scenarios.
 * Each live scenario runs in its own temporary home and project.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const SKILLS_CLI_VERSION = "1.5.22";
export const MISSING_CLI_MESSAGE = "Planloft CLI is required by the planloft-write-doc skill. Install it with `npm install -g planloft`, `pnpm add -g planloft`, or `bun add -g planloft`, then retry in a new agent session.";
export const SHIPPED_SKILLS = ["planloft-customise", "planloft-write-doc"] as const;
export const DIMENSIONS = {
  runner: ["npx", "pnpm", "bunx"] as const,
  agent: ["codex", "claude-code", "pi"] as const,
  scope: ["project", "global"] as const,
  method: ["default", "copy"] as const,
  cli: ["absent", "installed"] as const,
  source: ["latest", "tagged"] as const,
  skill: SHIPPED_SKILLS,
} as const;

type Runner = typeof DIMENSIONS.runner[number];
type Agent = typeof DIMENSIONS.agent[number];
type Scope = typeof DIMENSIONS.scope[number];
type InstallMethod = typeof DIMENSIONS.method[number];
type CliState = typeof DIMENSIONS.cli[number];
type RemoteSource = typeof DIMENSIONS.source[number];
type Skill = typeof SHIPPED_SKILLS[number];
type Source = "local" | RemoteSource;

export interface InstallerScenario {
  runner: Runner;
  agent: Agent;
  scope: Scope;
  method: InstallMethod;
  cli: CliState;
  source: Source;
  skill: Skill;
  id: string;
}

interface ScenarioPaths {
  project: string;
  home: string;
  skill: Skill;
}

interface InstallerContext {
  home: string;
  project: string;
  env: NodeJS.ProcessEnv;
}

interface InstalledSkill {
  name: string;
}

interface Options {
  mode: "contract" | "live";
  source: Source | "all";
  tag?: string;
  workers: number;
  workerCase?: string;
  keep: boolean;
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RETIRED_SKILLS = [
  "write-doc",
  "customize",
  "customise",
  "write-plan",
  "customize-planloft",
  "save-doc",
  "planloft-preview",
  "planloft-copy",
  "planloft-deploy",
];

function isSkill(value: string): value is Skill {
  return (SHIPPED_SKILLS as readonly string[]).includes(value);
}

/** Returns the stable label printed for an installer scenario. */
export function caseId(entry: Omit<InstallerScenario, "id">): string {
  return [entry.runner, entry.agent, entry.scope, entry.method, entry.cli, entry.source, entry.skill].join("/");
}

/** Builds the real command used to invoke the pinned external skills CLI. */
export function runnerInvocation(runner: Runner | string, args: string[]): string[] {
  if (runner === "npx") return ["npx", "--yes", `skills@${SKILLS_CLI_VERSION}`, ...args];
  if (runner === "pnpm") return ["pnpm", "dlx", `skills@${SKILLS_CLI_VERSION}`, ...args];
  if (runner === "bunx") return ["bunx", `skills@${SKILLS_CLI_VERSION}`, ...args];
  throw new Error(`Unknown runner: ${runner}`);
}

/** Returns the GitHub tree URL accepted by the skills CLI for a tagged skill. */
export function taggedSkillSource(tag: string | undefined, skill: string): string {
  if (!/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(tag ?? "")) {
    throw new Error("A release source requires PLANLOFT_RELEASE_TAG=v<semver> or --tag v<semver>.");
  }
  if (!isSkill(skill)) throw new Error(`Unknown shipped skill: ${skill}`);
  return `https://github.com/hatim-s/planloft/tree/${tag}/skills/${skill}`;
}

/** Resolves a local, branch, or tag selector into a skills CLI source. */
export function sourceValue(source: Source, tag: string | undefined, skill: Skill): string {
  if (source === "local") return ROOT;
  if (source === "latest") return "hatim-s/planloft";
  if (source === "tagged") return taggedSkillSource(tag, skill);
  throw new Error(`Unknown source: ${source}`);
}

/** Returns the canonical path managed by the skills CLI. */
export function canonicalSkillPath({ scope, project, home, skill }: ScenarioPaths & { scope: Scope }): string {
  return path.join(scope === "global" ? home : project, ".agents", "skills", skill);
}

/** Returns the path read by the selected agent. */
export function agentSkillPath({ agent, scope, project, home, skill }: ScenarioPaths & { agent: Agent; scope: Scope }): string {
  const base = scope === "global" ? home : project;
  if (agent === "claude-code") return path.join(base, ".claude", "skills", skill);
  if (agent === "pi") {
    return path.join(base, scope === "global" ? ".pi/agent/skills" : ".pi/skills", skill);
  }
  return path.join(base, ".agents", "skills", skill);
}

/** Builds the 12 representative scenarios used before publication. */
export function quickMatrix(source: Source = "local"): InstallerScenario[] {
  const rows: ReadonlyArray<readonly [Runner, Agent, Scope, InstallMethod, CliState]> = [
    ["npx", "codex", "project", "default", "absent"],
    ["pnpm", "claude-code", "global", "copy", "installed"],
    ["bunx", "pi", "project", "copy", "absent"],
    ["npx", "claude-code", "project", "copy", "installed"],
    ["pnpm", "codex", "global", "copy", "absent"],
    ["bunx", "pi", "global", "default", "installed"],
  ];
  return rows.flatMap(([runner, agent, scope, method, cli]) => SHIPPED_SKILLS.map((skill) => {
    const entry = { runner, agent, scope, method, cli, source, skill };
    return { ...entry, id: caseId(entry) };
  }));
}

/** Distributes the same 12 scenarios across the branch and release tag. */
export function releaseMatrix(): InstallerScenario[] {
  return quickMatrix().map((entry, index) => {
    const row = Math.floor(index / SHIPPED_SKILLS.length);
    const skill = index % SHIPPED_SKILLS.length;
    const source: RemoteSource = (row + skill) % 2 === 0 ? "latest" : "tagged";
    const releaseEntry = { ...entry, source };
    return { ...releaseEntry, id: caseId(releaseEntry) };
  });
}

/** Checks static package, skill, documentation, and scenario contracts without network access. */
export function validateRepositoryContract(): { scenarios: number; skills: string[]; skillsCliVersion: string } {
  const scenarios = quickMatrix();
  assert.equal(scenarios.length, 12, "installer contract must contain 12 curated scenarios");
  assert.equal(new Set(scenarios.map(({ id }) => id)).size, scenarios.length, "scenario ids must be unique");
  for (const dimension of ["runner", "agent", "scope", "method", "cli", "skill"] as const) {
    assert.deepEqual(
      [...new Set(scenarios.map((entry) => entry[dimension]))].sort(),
      [...DIMENSIONS[dimension]].sort(),
      `${dimension} coverage drifted`,
    );
  }

  const skillRoot = path.join(ROOT, "skills");
  const discovered = fs.readdirSync(skillRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(skillRoot, entry.name, "SKILL.md")))
    .map((entry) => entry.name);
  assert.deepEqual(discovered.sort(), [...SHIPPED_SKILLS]);

  const customizationSkill = fs.readFileSync(path.join(skillRoot, "planloft-customise", "SKILL.md"), "utf8");
  const customizationUi = fs.readFileSync(path.join(skillRoot, "planloft-customise", "agents", "openai.yaml"), "utf8");
  assert.match(customizationSkill, /^name:\s*planloft-customise$/m);
  assert.match(customizationUi, /display_name:\s*"planloft:customise"/);
  assert.match(customizationSkill, /references\/how-planloft-works\.md/);
  assert.match(customizationSkill, /references\/themes\.md/);
  assert.match(customizationSkill, /assets\/theme-starter/);

  const skillPath = path.join(skillRoot, "planloft-write-doc");
  const skill = fs.readFileSync(path.join(skillPath, "SKILL.md"), "utf8");
  const skillUi = fs.readFileSync(path.join(skillPath, "agents", "openai.yaml"), "utf8");
  const resolverPath = path.join(skillPath, "scripts", "resolve-planloft-command.sh");
  assert.match(skill, /^name:\s*planloft-write-doc$/m);
  assert.match(skillUi, /display_name:\s*"planloft:write-doc"/);
  assert.match(skill, /scripts\/resolve-planloft-command\.sh/);
  assert.match(skill, /separately installed Planloft CLI/);
  assert.ok(fs.statSync(resolverPath).mode & 0o111, "skill CLI resolver must be executable");

  const resolverRoot = fs.mkdtempSync(path.join(os.tmpdir(), "planloft-resolver-contract-"));
  try {
    const installedSkill = path.join(resolverRoot, ".agents", "skills", "planloft-write-doc");
    fs.cpSync(skillPath, installedSkill, { recursive: true });
    const resolver = spawnSync(path.join(installedSkill, "scripts", "resolve-planloft-command.sh"), [], {
      cwd: resolverRoot,
      env: { HOME: resolverRoot, PATH: "/usr/bin:/bin" },
      encoding: "utf8",
    });
    assert.equal(resolver.status, 127, "standalone skill resolver must fail when the CLI is absent");
    assert.equal(resolver.stderr.trim(), MISSING_CLI_MESSAGE);
  } finally {
    fs.rmSync(resolverRoot, { recursive: true, force: true });
  }

  const packageJson = readJson("package.json");
  for (const asset of ["dist", "skills", "themes", "schemas", "templates"]) {
    assert.ok(packageJson.files.includes(asset), `npm package must include ${asset}`);
  }
  for (const removed of ["bin", "hooks", ".agents", ".codex-plugin", ".claude-plugin"]) {
    assert.ok(!packageJson.files.includes(removed), `npm package must not include retired ${removed} assets`);
  }

  const readme = fs.readFileSync(path.join(ROOT, "README.md"), "utf8");
  for (const command of [
    "npm install -g planloft",
    "pnpm add -g planloft",
    "bun add -g planloft",
    "npx skills add hatim-s/planloft --skill planloft-write-doc",
  ]) assert.ok(readme.includes(command), `README is missing ${command}`);
  assert.doesNotMatch(readme, /plugin/i);

  const setup = fs.readFileSync(path.join(ROOT, "docs", "setup.md"), "utf8");
  for (const agent of ["codex", "claude-code", "pi"]) {
    const projectRecipe = `npx skills add hatim-s/planloft --skill planloft-write-doc -a ${agent}`;
    const globalRecipe = `npx skills add hatim-s/planloft --skill planloft-write-doc -g -a ${agent}`;
    assert.ok(setup.includes(projectRecipe), `setup is missing ${agent} project recipe`);
    assert.ok(setup.includes(globalRecipe), `setup is missing ${agent} global recipe`);
  }

  const migration = fs.readFileSync(path.join(ROOT, "docs", "installation-migration.md"), "utf8");
  for (const retired of RETIRED_SKILLS) assert.ok(migration.includes(retired));
  for (const scope of ["Project", "Global"]) assert.ok(migration.includes(`| ${scope} |`));
  assert.match(migration, /installer-managed symlinks and\s+`--copy` installs/);
  assert.match(migration, /codex plugin remove planloft/);
  assert.match(migration, /claude plugin uninstall planloft@planloft/);
  assert.doesNotMatch(migration, /(?:codex|claude) plugin marketplace/);
  assert.doesNotMatch(migration, /plugin (?:marketplace|add|install) planloft/);

  return { scenarios: scenarios.length, skills: discovered, skillsCliVersion: SKILLS_CLI_VERSION };
}

function expectedSkillContent(source: Source, tag: string | undefined, skill: Skill): string {
  if (source === "local") return fs.readFileSync(path.join(ROOT, "skills", skill, "SKILL.md"), "utf8");
  return skillContentAtRef(source === "latest" ? "origin/main" : tag, skill);
}

function skillContentAtRef(ref: string | undefined, skill: Skill): string {
  if (!ref) throw new Error(`Missing Git ref for ${skill}.`);
  const result = spawnSync("git", ["show", `${ref}:skills/${skill}/SKILL.md`], {
    cwd: ROOT,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`Unable to read ${skill} from ${ref}: ${result.stderr.trim()}`);
  }
  return result.stdout;
}

function refreshRemoteRefs(): void {
  const result = spawnSync("git", ["fetch", "origin", "main", "--tags"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  if (result.status !== 0) throw new Error(`Unable to refresh release refs: ${result.stderr.trim()}`);
}

function readJson(relative: string): { files: string[] } {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relative), "utf8")) as { files: string[] };
}

function findExecutable(name: string): string {
  for (const directory of (process.env.PATH ?? "").split(path.delimiter)) {
    const candidate = path.join(directory, name);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {}
  }
  throw new Error(`Required executable is unavailable: ${name}`);
}

function executableDirectories(name: string): string[] {
  return (process.env.PATH ?? "").split(path.delimiter).filter((directory) => {
    try {
      fs.accessSync(path.join(directory, name), fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  }).map((directory) => path.resolve(directory));
}

function writeExecWrapper(target: string, destination: string): void {
  fs.writeFileSync(destination, `#!/bin/sh\nexec "${target}" "$@"\n`);
  fs.chmodSync(destination, 0o755);
}

function controlledEnvironment(root: string, cliState: CliState): InstallerContext {
  const home = path.join(root, "home");
  const project = path.join(root, "project");
  const runnerBin = path.join(root, "runner-bin");
  const cache = process.env.PLANLOFT_INSTALLER_CACHE_ROOT ?? path.join(root, "cache");
  for (const directory of [home, project, runnerBin, cache]) fs.mkdirSync(directory, { recursive: true });

  const excluded = new Set(executableDirectories("planloft"));
  const basePath = (process.env.PATH ?? "").split(path.delimiter)
    .filter((directory) => !excluded.has(path.resolve(directory)));
  for (const executable of ["node", "npm", "npx", "pnpm", "bun", "bunx", "git"]) {
    writeExecWrapper(findExecutable(executable), path.join(runnerBin, executable));
  }
  if (cliState === "installed") {
    const node = findExecutable("node");
    const cli = path.join(ROOT, "dist", "cli.js");
    assert.ok(fs.existsSync(cli), "run bun run build before the live installer matrix");
    fs.writeFileSync(path.join(runnerBin, "planloft"), `#!/bin/sh\nexec "${node}" "${cli}" "$@"\n`);
    fs.chmodSync(path.join(runnerBin, "planloft"), 0o755);
  }

  return {
    home,
    project,
    env: {
      ...process.env,
      HOME: home,
      XDG_CONFIG_HOME: path.join(home, ".config"),
      XDG_CACHE_HOME: path.join(cache, "xdg"),
      PLANLOFT_HOME: path.join(home, ".planloft"),
      CODEX_HOME: path.join(home, ".codex"),
      CLAUDE_CONFIG_DIR: path.join(home, ".claude"),
      BUN_INSTALL: path.join(home, ".bun"),
      BUN_INSTALL_CACHE_DIR: path.join(cache, "bun"),
      PNPM_HOME: path.join(home, ".pnpm"),
      npm_config_cache: path.join(cache, "npm"),
      npm_config_userconfig: path.join(home, ".npmrc"),
      NPM_CONFIG_USERCONFIG: path.join(home, ".npmrc"),
      npm_config_update_notifier: "false",
      DISABLE_TELEMETRY: "1",
      CI: "1",
      PATH: [runnerBin, ...basePath].join(path.delimiter),
    },
  };
}

function execute(command: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv }): string {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw new Error([
      `${command} ${args.join(" ")} failed (${result.status ?? (result.error as NodeJS.ErrnoException | undefined)?.code})`,
      result.stdout?.slice(-4000),
      result.stderr?.slice(-4000),
    ].filter(Boolean).join("\n"));
  }
  return result.stdout;
}

function executeSkills(entry: InstallerScenario, args: string[], context: InstallerContext): string {
  const [command, ...runnerArgs] = runnerInvocation(entry.runner, args);
  assert.ok(command, `${entry.id}: runner command is empty`);
  return execute(command, runnerArgs, { cwd: context.project, env: context.env });
}

function addArgs(entry: InstallerScenario, source: string): string[] {
  return [
    "add", source, "--skill", entry.skill,
    "--agent", entry.agent,
    ...(entry.scope === "global" ? ["--global"] : []),
    ...(entry.method === "copy" ? ["--copy"] : []),
    "--yes",
  ];
}

function listInstalled(entry: InstallerScenario, context: InstallerContext): InstalledSkill[] {
  const output = executeSkills(entry, [
    "list", "--agent", entry.agent,
    ...(entry.scope === "global" ? ["--global"] : []),
    "--json",
  ], context);
  const installed = JSON.parse(output.trim()) as unknown;
  assert.ok(Array.isArray(installed), `${entry.id}: skills list did not return an array`);
  for (const item of installed) {
    assert.ok(typeof item === "object" && item !== null && "name" in item && typeof item.name === "string");
  }
  return installed as InstalledSkill[];
}

function installationPaths(entry: InstallerScenario, context: InstallerContext): string[] {
  return [...new Set([
    canonicalSkillPath({ ...entry, ...context }),
    agentSkillPath({ ...entry, ...context }),
  ])];
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function assertInstallPath(entry: InstallerScenario, context: InstallerContext, expected: string, installPath: string): void {
  const skillFile = path.join(installPath, "SKILL.md");
  assert.ok(fs.existsSync(skillFile), `${entry.id}: installed skill missing at ${installPath}`);
  assert.ok(fs.statSync(installPath).isDirectory(), `${entry.id}: installed skill path is not a directory`);
  assert.equal(fs.readFileSync(skillFile, "utf8"), expected, `${entry.id}: installed content drift at ${installPath}`);

  const scopeRoot = entry.scope === "global" ? context.home : context.project;
  const resolved = fs.realpathSync(installPath);
  assert.ok(isInside(fs.realpathSync(scopeRoot), resolved), `${entry.id}: installed skill resolves outside its disposable scope`);

  if (entry.method === "copy") {
    assert.ok(!fs.lstatSync(installPath).isSymbolicLink(), `${entry.id}: --copy install unexpectedly became a symlink`);
  }

  for (const forbidden of ["hooks", "themes", ".agents", ".codex-plugin", ".claude-plugin"]) {
    assert.ok(!fs.existsSync(path.join(installPath, forbidden)), `${entry.id}: skill-only leaked ${forbidden}`);
  }
}

function assertSkillCliBehavior(entry: InstallerScenario, context: InstallerContext): void {
  if (entry.skill !== "planloft-write-doc") return;
  const target = agentSkillPath({ ...entry, ...context });
  const resolverPath = path.join(target, "scripts", "resolve-planloft-command.sh");
  const resolver = spawnSync(resolverPath, [], {
    cwd: context.project,
    env: context.env,
    encoding: "utf8",
  });
  if (entry.cli === "absent") {
    assert.equal(resolver.status, 127, `${entry.id}: missing-CLI resolver must exit 127`);
    assert.equal(resolver.stderr.trim(), MISSING_CLI_MESSAGE, `${entry.id}: missing-CLI guidance drift`);
    return;
  }

  assert.equal(resolver.status, 0, `${entry.id}: installed CLI resolver failed: ${resolver.stderr}`);
  const command = resolver.stdout.trim();
  assert.ok(command, `${entry.id}: resolver returned an empty CLI path`);
  const probe = spawnSync(command, ["resolve", "--kind", "plan", "--slug", "matrix", "--title", "Matrix"], {
    cwd: context.project,
    env: context.env,
    encoding: "utf8",
  });
  assert.equal(probe.status, 0, `${entry.id}: resolved CLI path failed: ${probe.stderr}`);
}

function assertInstalled(entry: InstallerScenario, context: InstallerContext, expected: string): void {
  const target = agentSkillPath({ ...entry, ...context });
  assert.ok(fs.existsSync(path.join(target, "SKILL.md")), `${entry.id}: agent skill missing`);
  for (const installPath of installationPaths(entry, context)) {
    if (fs.existsSync(installPath)) assertInstallPath(entry, context, expected, installPath);
  }
  if (entry.skill === "planloft-write-doc") {
    assert.match(expected, /scripts\/resolve-planloft-command\.sh/);
  } else {
    assert.match(expected, /references\/how-planloft-works\.md/);
    assert.match(expected, /assets\/theme-starter/);
  }
  assertSkillCliBehavior(entry, context);

  const listed = listInstalled(entry, context);
  assert.deepEqual([...new Set(listed.map(({ name }) => name))], [entry.skill], `${entry.id}: discovery list mismatch`);
  assert.equal(listed.length, 1, `${entry.id}: expected exactly one discovered skill`);
}

function assertRemoved(entry: InstallerScenario, context: InstallerContext): void {
  for (const installPath of installationPaths(entry, context)) {
    assert.ok(!fs.existsSync(installPath), `${entry.id}: remove left installer path ${installPath}`);
  }
  assert.equal(listInstalled(entry, context).filter(({ name }) => name === entry.skill).length, 0, `${entry.id}: remove left the skill discoverable`);
}

function runLiveCase(entry: InstallerScenario, tag: string | undefined, keep: boolean, expected: string): { id: string; root?: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "planloft-installer-matrix-"));
  const context = controlledEnvironment(root, entry.cli);
  const source = sourceValue(entry.source, tag, entry.skill);
  try {
    const probe = spawnSync("planloft", ["resolve", "--kind", "plan", "--slug", "matrix", "--title", "Matrix"], {
      cwd: context.project, env: context.env, encoding: "utf8",
    });
    if (entry.cli === "installed") {
      assert.equal(probe.status, 0, `${entry.id}: installed CLI resolve failed: ${probe.stderr}`);
    } else {
      assert.ok((probe.error as NodeJS.ErrnoException | undefined)?.code === "ENOENT" || probe.status === 127, `${entry.id}: CLI unexpectedly available`);
    }

    executeSkills(entry, addArgs(entry, source), context);
    assertInstalled(entry, context, expected);

    executeSkills(entry, ["update", entry.skill, entry.scope === "global" ? "--global" : "--project", "--yes"], context);
    assertInstalled(entry, context, expected);

    executeSkills(entry, [
      "remove", entry.skill, "--agent", entry.agent,
      ...(entry.scope === "global" ? ["--global"] : []), "--yes",
    ], context);
    assertRemoved(entry, context);

    executeSkills(entry, addArgs(entry, source), context);
    assertInstalled(entry, context, expected);
    return { id: entry.id, root: keep ? root : undefined };
  } finally {
    if (!keep) fs.rmSync(root, { recursive: true, force: true });
  }
}

function runCaseWorker(entry: InstallerScenario, tag: string | undefined, keep: boolean, cache: string): Promise<{ id: string; root?: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      fileURLToPath(import.meta.url),
      "--worker-case",
      JSON.stringify(entry),
      ...(tag ? ["--tag", tag] : []),
      ...(keep ? ["--keep"] : []),
    ], {
      cwd: ROOT,
      env: { ...process.env, PLANLOFT_INSTALLER_CACHE_ROOT: cache },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error([
          `${entry.id} failed (${code})`,
          stdout.trim(),
          stderr.trim(),
        ].filter(Boolean).join("\n")));
        return;
      }
      try {
        resolve(JSON.parse(stdout.trim()) as { id: string; root?: string });
      } catch {
        reject(new Error(`${entry.id} worker returned invalid output: ${stdout.trim()}`));
      }
    });
  });
}

async function runParallelCases(cases: InstallerScenario[], tag: string | undefined, keep: boolean, workers: number): Promise<void> {
  const cache = fs.mkdtempSync(path.join(os.tmpdir(), "planloft-installer-cache-"));
  let cursor = 0;
  let failure: unknown;
  const runWorker = async () => {
    while (failure === undefined) {
      const index = cursor;
      cursor += 1;
      const entry = cases[index];
      if (!entry) return;
      try {
        const result = await runCaseWorker(entry, tag, keep, cache);
        console.log(`[${index + 1}/${cases.length}] PASS ${result.id}${result.root ? ` kept=${result.root}` : ""}`);
      } catch (error) {
        failure ??= error;
      }
    }
  };
  try {
    await Promise.all(Array.from({ length: Math.min(workers, cases.length) }, runWorker));
    if (failure !== undefined) throw failure;
  } finally {
    fs.rmSync(cache, { recursive: true, force: true });
  }
}

function parseOptions(argv: string[]): Options {
  const get = (name: string, fallback?: string): string | undefined => {
    const index = argv.indexOf(name);
    return index >= 0 ? argv[index + 1] : fallback;
  };
  return {
    mode: argv.includes("--live") ? "live" : "contract",
    source: get("--source", "local") as Source | "all",
    tag: get("--tag", process.env.PLANLOFT_RELEASE_TAG),
    workers: Number(get("--workers", "4")),
    workerCase: get("--worker-case", undefined),
    keep: argv.includes("--keep"),
  };
}

/** Runs a static contract check or the disposable live installer scenarios. */
export async function main(argv = process.argv.slice(2)): Promise<void> {
  const options = parseOptions(argv);
  if (options.workerCase !== undefined) {
    const entry = JSON.parse(options.workerCase) as InstallerScenario;
    const expected = expectedSkillContent(entry.source, options.tag, entry.skill);
    const result = runLiveCase(entry, options.tag, options.keep, expected);
    process.stdout.write(JSON.stringify(result));
    return;
  }

  if (options.mode === "contract") {
    const contract = validateRepositoryContract();
    console.log(
      `installer contract: ${contract.scenarios} scenarios; skills=${contract.skills.join(",")}; ` +
      `skills-cli=${contract.skillsCliVersion}`,
    );
    return;
  }
  if (!Number.isInteger(options.workers) || options.workers < 1 || options.workers > 16) {
    throw new Error("--workers must be an integer between 1 and 16.");
  }

  const sources: Source[] = options.source === "all" ? ["latest", "tagged"] : [options.source];
  if (sources.some((source) => source !== "local")) refreshRemoteRefs();
  if (sources.includes("tagged")) {
    taggedSkillSource(options.tag, SHIPPED_SKILLS[0]);
  }
  const cases = options.source === "all" ? releaseMatrix() : quickMatrix(options.source);
  console.log(`installer live matrix: ${cases.length} disposable scenarios (${sources.join("+")}, ${options.workers} workers)`);
  await runParallelCases(cases, options.tag, options.keep, options.workers);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 1;
  });
}
