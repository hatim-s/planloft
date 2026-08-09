#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const SKILLS_CLI_VERSION = "1.5.22";
export const MISSING_CLI_MESSAGE = "Planloft CLI is required by the planloft-write-doc skill. Install it with `npm install -g planloft`, `pnpm add -g planloft`, or `bun add -g planloft`, then retry in a new agent session.";
export const SHIPPED_SKILLS = Object.freeze(["planloft-customise", "planloft-write-doc"]);
export const DIMENSIONS = Object.freeze({
  runner: ["npx", "pnpm", "bunx"],
  agent: ["codex", "claude-code", "pi"],
  scope: ["project", "global"],
  method: ["default", "copy"],
  cli: ["absent", "installed"],
  source: ["latest", "tagged"],
  skill: SHIPPED_SKILLS,
});

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

export function buildMatrix(dimensions = DIMENSIONS) {
  let cases = [{}];
  for (const [dimension, values] of Object.entries(dimensions)) {
    cases = cases.flatMap((entry) => values.map((value) => ({ ...entry, [dimension]: value })));
  }
  return cases.map((entry) => ({ ...entry, id: caseId(entry) }));
}

export function caseId(entry) {
  return [entry.runner, entry.agent, entry.scope, entry.method, entry.cli, entry.source, entry.skill].join("/");
}

export function runnerInvocation(runner, args) {
  if (runner === "npx") return ["npx", "--yes", `skills@${SKILLS_CLI_VERSION}`, ...args];
  if (runner === "pnpm") return ["pnpm", "dlx", `skills@${SKILLS_CLI_VERSION}`, ...args];
  if (runner === "bunx") return ["bunx", `skills@${SKILLS_CLI_VERSION}`, ...args];
  throw new Error(`Unknown runner: ${runner}`);
}

export function taggedSkillSource(tag, skill) {
  if (!/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(tag ?? "")) {
    throw new Error("A release source requires PLANLOFT_RELEASE_TAG=v<semver> or --tag v<semver>.");
  }
  if (!SHIPPED_SKILLS.includes(skill)) throw new Error(`Unknown shipped skill: ${skill}`);
  return `https://github.com/hatim-s/planloft/tree/${tag}/skills/${skill}`;
}

export function taggedSkillRawUrl(tag, skill) {
  taggedSkillSource(tag, skill);
  return `https://raw.githubusercontent.com/hatim-s/planloft/${tag}/skills/${skill}/SKILL.md`;
}

export function expectedSourceSkillCount(source) {
  if (source === "tagged") return 1;
  if (source === "local" || source === "latest") return SHIPPED_SKILLS.length;
  throw new Error(`Unknown source: ${source}`);
}

export function sourceValue(source, tag, skill) {
  if (source === "local") return ROOT;
  if (source === "latest") return "hatim-s/planloft";
  if (source === "tagged") return taggedSkillSource(tag, skill);
  throw new Error(`Unknown source: ${source}`);
}

export function canonicalSkillPath({ scope, project, home, skill }) {
  return path.join(scope === "global" ? home : project, ".agents", "skills", skill);
}

export function agentSkillPath({ agent, scope, project, home, skill }) {
  const base = scope === "global" ? home : project;
  if (agent === "claude-code") return path.join(base, ".claude", "skills", skill);
  if (agent === "pi") {
    return path.join(base, scope === "global" ? ".pi/agent/skills" : ".pi/skills", skill);
  }
  return path.join(base, ".agents", "skills", skill);
}

export function quickMatrix(source = "local") {
  const rows = [
    ["npx", "codex", "project", "default", "absent"],
    ["pnpm", "claude-code", "global", "copy", "installed"],
    ["bunx", "pi", "project", "copy", "absent"],
    ["npx", "claude-code", "project", "default", "installed"],
    ["pnpm", "codex", "global", "copy", "absent"],
    ["bunx", "pi", "global", "default", "installed"],
  ];
  return rows.flatMap(([runner, agent, scope, method, cli]) => SHIPPED_SKILLS.map((skill) => {
    const entry = { runner, agent, scope, method, cli, source, skill };
    return { ...entry, id: caseId(entry) };
  }));
}

export function validateRepositoryContract() {
  const matrix = buildMatrix();
  assert.equal(matrix.length, 288, "full installer contract must contain 288 cases");
  assert.equal(new Set(matrix.map(({ id }) => id)).size, matrix.length, "case ids must be unique");

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

  return { cases: matrix.length, skills: discovered, skillsCliVersion: SKILLS_CLI_VERSION };
}

async function expectedSkillContent(source, tag, skill) {
  if (source === "local") return fs.readFileSync(path.join(ROOT, "skills", skill, "SKILL.md"), "utf8");
  const ref = source === "latest" ? "main" : tag;
  const response = await fetch(`https://raw.githubusercontent.com/hatim-s/planloft/${ref}/skills/${skill}/SKILL.md`);
  if (!response.ok) throw new Error(`Unable to fetch expected ${source} skill ${skill} at ${ref}: HTTP ${response.status}`);
  return response.text();
}

async function validateTaggedSkillInventory(tag) {
  for (const skill of SHIPPED_SKILLS) {
    const response = await fetch(taggedSkillRawUrl(tag, skill));
    if (!response.ok) throw new Error(`Unable to fetch tagged skill ${skill} at ${tag}: HTTP ${response.status}`);
    assert.match(await response.text(), new RegExp(`^name:\\s*${skill}$`, "m"));
  }
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
      CODEX_HOME: path.join(home, ".codex"),
      CLAUDE_CONFIG_DIR: path.join(home, ".claude"),
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
  return [
    "add", source, "--skill", entry.skill,
    "--agent", entry.agent,
    ...(entry.scope === "global" ? ["--global"] : []),
    ...(entry.method === "copy" ? ["--copy"] : []),
    "--yes",
  ];
}

function listInstalled(entry, context) {
  const output = executeSkills(entry, [
    "list", "--agent", entry.agent,
    ...(entry.scope === "global" ? ["--global"] : []),
    "--json",
  ], context);
  return JSON.parse(output.trim());
}

function installationPaths(entry, context) {
  return [...new Set([
    canonicalSkillPath({ ...entry, ...context }),
    agentSkillPath({ ...entry, ...context }),
  ])];
}

function assertSkillCliBehavior(entry, context) {
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

function assertInstalled(entry, context, expected) {
  const canonical = canonicalSkillPath({ ...entry, ...context });
  const target = agentSkillPath({ ...entry, ...context });
  assert.ok(fs.existsSync(path.join(target, "SKILL.md")), `${entry.id}: agent skill missing`);
  assert.equal(fs.readFileSync(path.join(target, "SKILL.md"), "utf8"), expected, `${entry.id}: installed content drift`);
  assert.ok(fs.lstatSync(target).isDirectory(), `${entry.id}: single-agent ${entry.method} install must be a direct directory copy`);
  assert.ok(!fs.lstatSync(target).isSymbolicLink(), `${entry.id}: exact agent path unexpectedly became a symlink`);
  if (canonical !== target) {
    assert.ok(!fs.existsSync(canonical), `${entry.id}: single-agent install leaked a canonical copy outside the agent path`);
  }
  for (const forbidden of ["hooks", "themes", ".agents", ".codex-plugin", ".claude-plugin"]) {
    assert.ok(!fs.existsSync(path.join(target, forbidden)), `${entry.id}: skill-only leaked ${forbidden}`);
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

function assertRemoved(entry, context) {
  for (const installPath of installationPaths(entry, context)) {
    assert.ok(!fs.existsSync(installPath), `${entry.id}: remove left installer path ${installPath}`);
  }
  assert.equal(listInstalled(entry, context).filter(({ name }) => name === entry.skill).length, 0, `${entry.id}: remove left the skill discoverable`);
}

async function runLiveCase(entry, tag, keep) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "planloft-installer-matrix-"));
  const context = controlledEnvironment(root, entry.cli);
  const source = sourceValue(entry.source, tag, entry.skill);
  const expected = await expectedSkillContent(entry.source, tag, entry.skill);
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
    const discoveredCount = expectedSourceSkillCount(entry.source);
    assert.match(
      addOutput,
      new RegExp(`Found ${discoveredCount} skill(?:s)?`),
      `${entry.id}: source discovery count drift`,
    );
    assert.match(addOutput, new RegExp(`${entry.skill} \\(copied\\)`), `${entry.id}: pinned installer did not report a direct copy at the selected agent`);
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
    console.log(
      `installer contract: ${contract.cases} cases; skills=${contract.skills.join(",")}; ` +
      `skills-cli=${contract.skillsCliVersion}`,
    );
    return;
  }

  const sources = options.source === "all" ? ["latest", "tagged"] : [options.source];
  if (sources.includes("tagged")) await validateTaggedSkillInventory(options.tag);
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
