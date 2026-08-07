#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const SKILLS_CLI_VERSION = "1.5.22";
export const DIMENSIONS = Object.freeze({
  runner: ["npx", "pnpm", "bunx"],
  agent: ["codex", "claude-code"],
  scope: ["project", "global"],
  method: ["symlink", "copy"],
  cli: ["absent", "installed"],
  source: ["latest", "tagged"],
});

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RETIRED_SKILLS = ["save-doc", "planloft-preview", "planloft-copy", "planloft-deploy"];

export function buildMatrix(dimensions = DIMENSIONS) {
  let cases = [{}];
  for (const [dimension, values] of Object.entries(dimensions)) {
    cases = cases.flatMap((entry) => values.map((value) => ({ ...entry, [dimension]: value })));
  }
  return cases.map((entry) => ({ ...entry, id: caseId(entry) }));
}

export function caseId(entry) {
  return [entry.runner, entry.agent, entry.scope, entry.method, entry.cli, entry.source].join("/");
}

export function runnerInvocation(runner, args) {
  if (runner === "npx") return ["npx", "--yes", `skills@${SKILLS_CLI_VERSION}`, ...args];
  if (runner === "pnpm") return ["pnpm", "dlx", `skills@${SKILLS_CLI_VERSION}`, ...args];
  if (runner === "bunx") return ["bunx", `skills@${SKILLS_CLI_VERSION}`, ...args];
  throw new Error(`Unknown runner: ${runner}`);
}

export function taggedSkillSource(tag) {
  if (!/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(tag ?? "")) {
    throw new Error("A release source requires PLANLOFT_RELEASE_TAG=v<semver> or --tag v<semver>.");
  }
  return `https://github.com/hatim-s/planloft/tree/${tag}/skills/write-plan`;
}

export function sourceValue(source, tag) {
  if (source === "local") return ROOT;
  if (source === "latest") return "hatim-s/planloft";
  if (source === "tagged") return taggedSkillSource(tag);
  throw new Error(`Unknown source: ${source}`);
}

export function canonicalSkillPath({ scope, project, home }) {
  return path.join(scope === "global" ? home : project, ".agents", "skills", "write-plan");
}

export function agentSkillPath({ agent, scope, project, home }) {
  const base = scope === "global" ? home : project;
  return agent === "claude-code"
    ? path.join(base, ".claude", "skills", "write-plan")
    : path.join(base, ".agents", "skills", "write-plan");
}

export function quickMatrix(source = "local") {
  const rows = [
    ["npx", "codex", "project", "symlink", "absent"],
    ["pnpm", "claude-code", "global", "copy", "installed"],
    ["bunx", "codex", "global", "copy", "absent"],
    ["npx", "claude-code", "project", "symlink", "installed"],
    ["pnpm", "codex", "project", "copy", "absent"],
    ["bunx", "claude-code", "global", "symlink", "installed"],
  ];
  return rows.map(([runner, agent, scope, method, cli]) => {
    const entry = { runner, agent, scope, method, cli, source };
    return { ...entry, id: caseId(entry) };
  });
}

export function validateRepositoryContract() {
  const matrix = buildMatrix();
  assert.equal(matrix.length, 96, "full installer contract must contain 96 cases");
  assert.equal(new Set(matrix.map(({ id }) => id)).size, matrix.length, "case ids must be unique");

  const skillRoot = path.join(ROOT, "skills");
  const discovered = fs.readdirSync(skillRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(skillRoot, entry.name, "SKILL.md")))
    .map((entry) => entry.name);
  assert.deepEqual(discovered, ["write-plan"]);

  const skill = fs.readFileSync(path.join(skillRoot, "write-plan", "SKILL.md"), "utf8");
  assert.match(skill, /^name:\s*write-plan$/m);
  assert.match(skill, /Planloft CLI is required by the write-plan skill/);
  assert.match(skill, /npm install -g planloft/);
  assert.match(skill, /Skill-only installation does\s+not install the executable, hooks, themes, runtime assets, or plugin metadata\./);
  assert.doesNotMatch(skill, /hooks? (?:were|are|have been) installed/i);

  const packageJson = readJson("package.json");
  for (const asset of ["dist", "skills", "hooks", "themes", "schemas", ".agents", ".codex-plugin", ".claude-plugin"]) {
    assert.ok(packageJson.files.includes(asset), `npm package must include ${asset}`);
  }
  for (const file of [".agents/plugins/marketplace.json", ".claude-plugin/marketplace.json"]) {
    const marketplace = readJson(file);
    assert.equal(marketplace.plugins.length, 1);
    assert.equal(marketplace.plugins[0].name, "planloft");
    assert.equal(marketplace.plugins[0].source.source, "npm");
    assert.equal(marketplace.plugins[0].source.package, "planloft");
    assert.equal(marketplace.plugins[0].source.version, packageJson.version);
  }

  const readme = fs.readFileSync(path.join(ROOT, "README.md"), "utf8");
  for (const command of [
    "npm install -g planloft",
    "pnpm add -g planloft",
    "bun add -g planloft",
    "npx skills add hatim-s/planloft --skill write-plan",
    "pnpm dlx skills add hatim-s/planloft --skill write-plan",
    "bunx skills add hatim-s/planloft --skill write-plan",
    "codex plugin add planloft@planloft",
    "claude plugin install planloft@planloft",
  ]) assert.ok(readme.includes(command), `README is missing ${command}`);
  for (const [runner, prefix] of [
    ["npm", "npx skills"],
    ["pnpm", "pnpm dlx skills"],
    ["bun", "bunx skills"],
  ]) {
    for (const agent of ["codex", "claude-code"]) {
      const projectRecipe = `${prefix} add hatim-s/planloft --skill write-plan -a ${agent}`;
      const globalRecipe = `${prefix} add hatim-s/planloft --skill write-plan -g -a ${agent}`;
      assert.ok(readme.includes(projectRecipe), `README is missing ${runner}/${agent} project recipe`);
      assert.ok(readme.includes(globalRecipe), `README is missing ${runner}/${agent} global recipe`);
    }
  }
  assert.match(readme, /does not pin a skill fetched from GitHub/);
  assert.match(readme, /Skill-only installation never installs or enables hooks/);
  assert.ok(readme.includes(taggedSkillSource(`v${packageJson.version}`)));

  const migration = fs.readFileSync(path.join(ROOT, "docs", "installation-migration.md"), "utf8");
  for (const retired of RETIRED_SKILLS) assert.ok(migration.includes(retired));
  for (const scope of ["Project", "Global"]) assert.ok(migration.includes(`| ${scope} |`));
  assert.match(migration, /installer-managed symlinks and\s+`--copy` installs/);
  assert.match(migration, /codex plugin remove planloft/);
  assert.match(migration, /claude plugin uninstall planloft@planloft/);

  return { cases: matrix.length, skills: discovered, skillsCliVersion: SKILLS_CLI_VERSION };
}

async function expectedSkillContent(source, tag) {
  if (source === "local") return fs.readFileSync(path.join(ROOT, "skills", "write-plan", "SKILL.md"), "utf8");
  const ref = source === "latest" ? "main" : tag;
  const response = await fetch(`https://raw.githubusercontent.com/hatim-s/planloft/${ref}/skills/write-plan/SKILL.md`);
  if (!response.ok) throw new Error(`Unable to fetch expected ${source} skill at ${ref}: HTTP ${response.status}`);
  return response.text();
}

function readJson(relative) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relative), "utf8"));
}

function findExecutable(name) {
  for (const directory of (process.env.PATH ?? "").split(path.delimiter)) {
    const candidate = path.join(directory, name);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {}
  }
  throw new Error(`Required executable is unavailable: ${name}`);
}

function executableDirectories(name) {
  return (process.env.PATH ?? "").split(path.delimiter).filter((directory) => {
    try {
      fs.accessSync(path.join(directory, name), fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  }).map((directory) => path.resolve(directory));
}

function writeExecWrapper(target, destination) {
  fs.writeFileSync(destination, `#!/bin/sh\nexec "${target}" "$@"\n`);
  fs.chmodSync(destination, 0o755);
}

function controlledEnvironment(root, cliState) {
  const home = path.join(root, "home");
  const project = path.join(root, "project");
  const runnerBin = path.join(root, "runner-bin");
  for (const directory of [home, project, runnerBin, path.join(root, "cache")]) fs.mkdirSync(directory, { recursive: true });

  const excluded = new Set(executableDirectories("planloft"));
  const basePath = (process.env.PATH ?? "").split(path.delimiter)
    .filter((directory) => !excluded.has(path.resolve(directory)));
  for (const executable of ["node", "npm", "npx", "pnpm", "bun", "bunx", "git"]) {
    writeExecWrapper(findExecutable(executable), path.join(runnerBin, executable));
  }
  if (cliState === "installed") {
    const node = findExecutable("node");
    const cli = path.join(ROOT, "dist", "cli.js");
    assert.ok(fs.existsSync(cli), "run npm run build before the live installer matrix");
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
      XDG_CACHE_HOME: path.join(root, "cache", "xdg"),
      PLANLOFT_HOME: path.join(home, ".planloft"),
      BUN_INSTALL: path.join(home, ".bun"),
      PNPM_HOME: path.join(home, ".pnpm"),
      npm_config_cache: path.join(root, "cache", "npm"),
      npm_config_userconfig: path.join(home, ".npmrc"),
      NPM_CONFIG_USERCONFIG: path.join(home, ".npmrc"),
      npm_config_update_notifier: "false",
      DISABLE_TELEMETRY: "1",
      CI: "1",
      PATH: [runnerBin, ...basePath].join(path.delimiter),
    },
  };
}

function execute(command, args, options) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw new Error([
      `${command} ${args.join(" ")} failed (${result.status ?? result.error?.code})`,
      result.stdout?.slice(-4000),
      result.stderr?.slice(-4000),
    ].filter(Boolean).join("\n"));
  }
  return result.stdout;
}

function executeSkills(entry, args, context) {
  const [command, ...runnerArgs] = runnerInvocation(entry.runner, args);
  return execute(command, runnerArgs, { cwd: context.project, env: context.env });
}

function addArgs(entry, source) {
  const secondaryAgent = entry.agent === "codex" ? "claude-code" : "codex";
  return [
    "add", source, "--skill", "write-plan",
    "--agent", entry.agent, "--agent", secondaryAgent,
    ...(entry.scope === "global" ? ["--global"] : []),
    ...(entry.method === "copy" ? ["--copy"] : []),
    "--yes",
  ];
}

function listInstalled(entry, context) {
  const output = executeSkills(entry, ["list", ...(entry.scope === "global" ? ["--global"] : []), "--json"], context);
  return JSON.parse(output.trim());
}

function assertInstalled(entry, context, expected) {
  const canonical = canonicalSkillPath({ ...entry, ...context });
  const target = agentSkillPath({ ...entry, ...context });
  const claudeTarget = agentSkillPath({ ...entry, ...context, agent: "claude-code" });
  assert.ok(fs.existsSync(path.join(canonical, "SKILL.md")), `${entry.id}: canonical skill missing`);
  assert.ok(fs.existsSync(path.join(target, "SKILL.md")), `${entry.id}: agent skill missing`);
  assert.ok(fs.existsSync(path.join(claudeTarget, "SKILL.md")), `${entry.id}: Claude discovery path missing`);
  assert.equal(fs.readFileSync(path.join(target, "SKILL.md"), "utf8"), expected, `${entry.id}: installed content drift`);
  assert.equal(fs.readFileSync(path.join(claudeTarget, "SKILL.md"), "utf8"), expected, `${entry.id}: secondary agent content drift`);

  assert.ok(fs.lstatSync(canonical).isDirectory(), `${entry.id}: Codex canonical skill must be a directory`);
  assert.equal(fs.lstatSync(claudeTarget).isSymbolicLink(), entry.method === "symlink", `${entry.id}: copy/symlink mismatch`);
  for (const forbidden of ["hooks", "themes", ".codex-plugin", ".claude-plugin"]) {
    assert.ok(!fs.existsSync(path.join(target, forbidden)), `${entry.id}: skill-only leaked ${forbidden}`);
  }
  assert.match(expected, /Planloft CLI is required by the write-plan skill/);
  assert.doesNotMatch(expected, /hooks? (?:were|are|have been) installed/i);

  const listed = listInstalled(entry, context);
  assert.deepEqual([...new Set(listed.map(({ name }) => name))], ["write-plan"], `${entry.id}: discovery list mismatch`);
  assert.equal(listed.length, 1, `${entry.id}: expected exactly one discovered skill`);
}

async function runLiveCase(entry, tag, keep) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "planloft-installer-matrix-"));
  const context = controlledEnvironment(root, entry.cli);
  const source = sourceValue(entry.source, tag);
  const expected = await expectedSkillContent(entry.source, tag);
  try {
    const probe = spawnSync("planloft", ["resolve", "--kind", "plan", "--slug", "matrix", "--title", "Matrix"], {
      cwd: context.project, env: context.env, encoding: "utf8",
    });
    if (entry.cli === "installed") {
      assert.equal(probe.status, 0, `${entry.id}: installed CLI resolve failed: ${probe.stderr}`);
    } else {
      assert.ok(probe.error?.code === "ENOENT" || probe.status === 127, `${entry.id}: CLI unexpectedly available`);
    }

    const addOutput = executeSkills(entry, addArgs(entry, source), context);
    assert.match(addOutput, /Found 1 skill/, `${entry.id}: source did not discover exactly one skill`);
    assertInstalled(entry, context, expected);

    executeSkills(entry, ["update", "write-plan", entry.scope === "global" ? "--global" : "--project", "--yes"], context);
    assertInstalled(entry, context, expected);

    executeSkills(entry, [
      "remove", "write-plan", "--agent", "codex", "--agent", "claude-code",
      ...(entry.scope === "global" ? ["--global"] : []), "--yes",
    ], context);
    assert.equal(listInstalled(entry, context).filter(({ name }) => name === "write-plan").length, 0, `${entry.id}: remove failed`);

    executeSkills(entry, addArgs(entry, source), context);
    assertInstalled(entry, context, expected);
    return { id: entry.id, root: keep ? root : undefined };
  } finally {
    if (!keep) fs.rmSync(root, { recursive: true, force: true });
  }
}

function parseOptions(argv) {
  const get = (name, fallback) => {
    const index = argv.indexOf(name);
    return index >= 0 ? argv[index + 1] : fallback;
  };
  return {
    mode: argv.includes("--live") ? "live" : "contract",
    breadth: argv.includes("--full") ? "full" : "quick",
    source: get("--source", "local"),
    tag: get("--tag", process.env.PLANLOFT_RELEASE_TAG),
    caseIndex: get("--case-index", undefined),
    keep: argv.includes("--keep"),
  };
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseOptions(argv);
  const contract = validateRepositoryContract();
  if (options.mode === "contract") {
    console.log(`installer contract: ${contract.cases} cases; skill=${contract.skills[0]}; skills-cli=${contract.skillsCliVersion}`);
    return;
  }

  const sources = options.source === "all" ? ["latest", "tagged"] : [options.source];
  if (sources.includes("tagged")) taggedSkillSource(options.tag);
  let cases = options.breadth === "full"
    ? buildMatrix({ ...DIMENSIONS, source: sources })
    : sources.flatMap((source) => quickMatrix(source));
  if (options.caseIndex !== undefined) {
    const index = Number(options.caseIndex);
    if (!Number.isInteger(index) || index < 1 || index > cases.length) {
      throw new Error(`--case-index must be between 1 and ${cases.length}`);
    }
    cases = [cases[index - 1]];
  }
  console.log(`installer live matrix: ${cases.length} disposable cases (${options.breadth}, ${sources.join("+")})`);
  for (const [index, entry] of cases.entries()) {
    const result = await runLiveCase(entry, options.tag, options.keep);
    console.log(`[${index + 1}/${cases.length}] PASS ${result.id}${result.root ? ` kept=${result.root}` : ""}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.stack ?? error);
    process.exitCode = 1;
  });
}
