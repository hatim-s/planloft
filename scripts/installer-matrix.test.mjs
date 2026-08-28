import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import {
  DIMENSIONS,
  SKILLS_CLI_VERSION,
  SHIPPED_SKILLS,
  agentSkillPath,
  buildMatrix,
  canonicalSkillPath,
  quickMatrix,
  runnerInvocation,
  sourceValue,
  taggedSkillSource,
  taggedSkillRawUrl,
  validateRepositoryContract,
} from "./installer-matrix.mjs";

test("full contract enumerates every installer dimension exactly once", () => {
  const matrix = buildMatrix();
  assert.equal(matrix.length, 288);
  assert.equal(new Set(matrix.map(({ id }) => id)).size, 288);
  assert.deepEqual(DIMENSIONS.method, ["default", "copy"]);
  for (const [dimension, values] of Object.entries(DIMENSIONS)) {
    assert.deepEqual([...new Set(matrix.map((entry) => entry[dimension]))].sort(), [...values].sort());
  }
});

test("quick live matrix covers every non-source dimension value", () => {
  const matrix = quickMatrix();
  assert.equal(matrix.length, 12);
  for (const dimension of ["runner", "agent", "scope", "method", "cli", "skill"]) {
    assert.deepEqual(
      [...new Set(matrix.map((entry) => entry[dimension]))].sort(),
      [...DIMENSIONS[dimension]].sort(),
    );
  }
  assert.deepEqual(
    [...new Set(matrix.map(({ agent, scope }) => `${agent}/${scope}`))].sort(),
    ["claude-code/global", "claude-code/project", "codex/global", "codex/project", "pi/global", "pi/project"],
  );
});

test("runner commands use the real package-runner forms and a tested skills version", () => {
  assert.deepEqual(runnerInvocation("npx", ["list"]), ["npx", "--yes", `skills@${SKILLS_CLI_VERSION}`, "list"]);
  assert.deepEqual(runnerInvocation("pnpm", ["list"]), ["pnpm", "dlx", `skills@${SKILLS_CLI_VERSION}`, "list"]);
  assert.deepEqual(runnerInvocation("bunx", ["list"]), ["bunx", `skills@${SKILLS_CLI_VERSION}`, "list"]);
  assert.throws(() => runnerInvocation("npm", []), /Unknown runner/);
});

test("latest and tagged GitHub skill sources are independent from npm versions", () => {
  assert.equal(sourceValue("latest"), "hatim-s/planloft");
  assert.equal(
    taggedSkillSource("v1.2.3", "planloft-write-doc"),
    "https://github.com/hatim-s/planloft/tree/v1.2.3/skills/planloft-write-doc",
  );
  assert.throws(() => taggedSkillSource("latest", "planloft-write-doc"), /PLANLOFT_RELEASE_TAG/);
  assert.equal(
    taggedSkillRawUrl("v1.2.3", "planloft-customise"),
    "https://raw.githubusercontent.com/hatim-s/planloft/v1.2.3/skills/planloft-customise/SKILL.md",
  );
  assert.throws(() => taggedSkillRawUrl("v1.2.3", "unknown"), /Unknown shipped skill/);
});

test("repository inventory contains both portable skills", () => {
  assert.deepEqual(SHIPPED_SKILLS, ["planloft-customise", "planloft-write-doc"]);
});

test("discovery paths stay inside the disposable project or home", () => {
  const project = "/tmp/project";
  const home = "/tmp/home";
  const skill = "planloft-customise";
  assert.equal(canonicalSkillPath({ scope: "project", project, home, skill }), path.join(project, ".agents/skills/planloft-customise"));
  assert.equal(canonicalSkillPath({ scope: "global", project, home, skill }), path.join(home, ".agents/skills/planloft-customise"));
  assert.equal(agentSkillPath({ agent: "codex", scope: "project", project, home, skill }), path.join(project, ".agents/skills/planloft-customise"));
  assert.equal(agentSkillPath({ agent: "claude-code", scope: "global", project, home, skill }), path.join(home, ".claude/skills/planloft-customise"));
  assert.equal(agentSkillPath({ agent: "pi", scope: "project", project, home, skill }), path.join(project, ".pi/skills/planloft-customise"));
  assert.equal(agentSkillPath({ agent: "pi", scope: "global", project, home, skill }), path.join(home, ".pi/agent/skills/planloft-customise"));
});

test("repository satisfies the portable installation contract", () => {
  assert.deepEqual(validateRepositoryContract(), {
    cases: 288,
    skills: ["planloft-customise", "planloft-write-doc"],
    skillsCliVersion: SKILLS_CLI_VERSION,
  });
});
