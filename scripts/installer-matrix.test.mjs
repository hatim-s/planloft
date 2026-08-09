import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import {
  DIMENSIONS,
  SKILLS_CLI_VERSION,
  agentHookConfigPaths,
  agentSkillPath,
  buildMatrix,
  canonicalSkillPath,
  quickMatrix,
  runnerInvocation,
  sourceValue,
  taggedSkillSource,
  validateRepositoryContract,
} from "./installer-matrix.mjs";

test("full contract enumerates every installer dimension exactly once", () => {
  const matrix = buildMatrix();
  assert.equal(matrix.length, 96);
  assert.equal(new Set(matrix.map(({ id }) => id)).size, 96);
  assert.deepEqual(DIMENSIONS.method, ["default", "copy"]);
  for (const [dimension, values] of Object.entries(DIMENSIONS)) {
    assert.deepEqual([...new Set(matrix.map((entry) => entry[dimension]))].sort(), [...values].sort());
  }
});

test("quick live matrix covers every non-source dimension value", () => {
  const matrix = quickMatrix();
  assert.equal(matrix.length, 6);
  for (const dimension of ["runner", "agent", "scope", "method", "cli"]) {
    assert.deepEqual(
      [...new Set(matrix.map((entry) => entry[dimension]))].sort(),
      [...DIMENSIONS[dimension]].sort(),
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
  assert.equal(sourceValue("latest"), "hatim-s/planloft");
  assert.equal(
    taggedSkillSource("v1.2.3"),
    "https://github.com/hatim-s/planloft/tree/v1.2.3/skills/write-plan",
  );
  assert.throws(() => taggedSkillSource("latest"), /PLANLOFT_RELEASE_TAG/);
});

test("discovery paths stay inside the disposable project or home", () => {
  const project = "/tmp/project";
  const home = "/tmp/home";
  assert.equal(canonicalSkillPath({ scope: "project", project, home }), path.join(project, ".agents/skills/write-plan"));
  assert.equal(canonicalSkillPath({ scope: "global", project, home }), path.join(home, ".agents/skills/write-plan"));
  assert.equal(agentSkillPath({ agent: "codex", scope: "project", project, home }), path.join(project, ".agents/skills/write-plan"));
  assert.equal(agentSkillPath({ agent: "claude-code", scope: "global", project, home }), path.join(home, ".claude/skills/write-plan"));
});

test("agent hook and plugin configuration probes stay inside disposable roots", () => {
  const paths = agentHookConfigPaths({ agent: "claude-code", project: "/tmp/project", home: "/tmp/home" });
  assert.ok(paths.includes(path.join("/tmp/project", ".claude/settings.json")));
  assert.ok(paths.includes(path.join("/tmp/home", ".claude/plugins")));
  assert.ok(paths.every((entry) => entry.startsWith("/tmp/project/") || entry.startsWith("/tmp/home/")));
});

test("repository satisfies the Phase 3 installation contract", () => {
  assert.deepEqual(validateRepositoryContract(), {
    cases: 96,
    skills: ["customize-planloft", "write-plan"],
    skillsCliVersion: SKILLS_CLI_VERSION,
  });
});
