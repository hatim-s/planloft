import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import {
  DIMENSIONS,
  SKILLS_CLI_VERSION,
  SHIPPED_SKILLS,
  agentSkillPath,
  canonicalSkillPath,
  quickMatrix,
  releaseMatrix,
  runnerInvocation,
  sourceValue,
  taggedSkillSource,
  validateRepositoryContract,
} from "./installer-matrix.js";

test("curated live scenarios cover every relevant dimension", () => {
  const matrix = quickMatrix();
  assert.equal(matrix.length, 12);
  for (const dimension of ["runner", "agent", "scope", "method", "cli", "skill"] as const) {
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

test("release scenarios cover latest and tagged sources without duplicating the matrix", () => {
  const matrix = releaseMatrix();
  assert.equal(matrix.length, 12);
  assert.deepEqual([...new Set(matrix.map(({ source }) => source))].sort(), ["latest", "tagged"]);
  for (const source of DIMENSIONS.source) {
    assert.deepEqual(
      [...new Set(matrix.filter((entry) => entry.source === source).map(({ skill }) => skill))].sort(),
      [...SHIPPED_SKILLS],
    );
  }
});

test("runner commands use the real package-runner forms and a tested skills version", () => {
  assert.deepEqual(runnerInvocation("npx", ["list"]), ["npx", "--yes", `skills@${SKILLS_CLI_VERSION}`, "list"]);
  assert.deepEqual(runnerInvocation("pnpm", ["list"]), ["pnpm", "dlx", `skills@${SKILLS_CLI_VERSION}`, "list"]);
  assert.deepEqual(runnerInvocation("bunx", ["list"]), ["bunx", `skills@${SKILLS_CLI_VERSION}`, "list"]);
  assert.throws(() => runnerInvocation("npm", []), /Unknown runner/);
});

test("latest and tagged GitHub skill sources are independent from npm versions", () => {
  assert.equal(sourceValue("latest", undefined, "planloft-write-doc"), "hatim-s/planloft");
  assert.equal(
    taggedSkillSource("v1.2.3", "planloft-write-doc"),
    "https://github.com/hatim-s/planloft/tree/v1.2.3/skills/planloft-write-doc",
  );
  assert.throws(() => taggedSkillSource("latest", "planloft-write-doc"), /PLANLOFT_RELEASE_TAG/);
  assert.throws(() => taggedSkillSource("v1.2.3", "unknown"), /Unknown shipped skill/);
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
    scenarios: 12,
    skills: ["planloft-customise", "planloft-write-doc"],
    skillsCliVersion: SKILLS_CLI_VERSION,
  });
});
