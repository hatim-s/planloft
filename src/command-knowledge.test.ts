import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import matter from "gray-matter";
import {
  COMMAND_CATEGORIES,
  COMMAND_KNOWLEDGE,
  PLUGIN_DEFAULT_PROMPTS,
  PUBLICATION_PRIVACY_DISCLOSURE,
  renderReadmeCliReference,
  renderSkillDiscoveryReference,
} from "./command-knowledge.js";
import { createProgram } from "./program.js";

const ROOT = path.resolve(import.meta.dirname, "..");

test("command knowledge covers every public command with examples and effects", () => {
  const commands = createProgram().commands.filter((command) => command.name() !== "__hook");
  assert.deepEqual(
    new Set(commands.map((command) => command.name())),
    new Set(COMMAND_KNOWLEDGE.map((command) => command.name)),
  );
  assert.equal(COMMAND_KNOWLEDGE.length, 11);
  assert.equal(new Set(COMMAND_KNOWLEDGE.map((command) => command.name)).size, 11);

  for (const command of COMMAND_KNOWLEDGE) {
    assert.ok(COMMAND_CATEGORIES.includes(command.category));
    assert.ok(command.purpose.length > 0);
    assert.ok(command.transition.includes("->"));
    assert.ok(command.examples.length > 0);
    assert.ok(["never", "optional", "always"].includes(command.localWrite));
    assert.ok(["never", "optional", "always"].includes(command.externalWrite));
  }
});

test("source metadata and copy replacement flags are exposed by the CLI", () => {
  const program = createProgram();
  for (const name of ["render", "hoist", "publish"]) {
    const command = program.commands.find((entry) => entry.name() === name);
    assert.ok(command);
    const flags = command.options.map((option) => option.long);
    for (const metadata of ["--title", "--slug", "--kind", "--theme", "--status"]) {
      assert.ok(flags.includes(metadata), `${name} is missing ${metadata}`);
    }
  }
  const copy = program.commands.find((entry) => entry.name() === "copy");
  assert.ok(copy?.options.some((option) => option.long === "--force"));
});

test("root help groups every public command and explains state and safety", async () => {
  const help = await captureHelp(["--help"]);
  for (const category of COMMAND_CATEGORIES) assert.match(help, new RegExp(category));
  for (const command of COMMAND_KNOWLEDGE) assert.ok(help.includes(command.signature));
  assert.match(help, /source -> canonical document -> store/);
  assert.match(help, /publish and deploy write to GitHub/);
  assert.ok(help.includes(PUBLICATION_PRIVACY_DISCLOSURE));
  assert.match(help, /rm deletes stored source/);
  assert.match(help, /--comments requires GitHub Discussions plus giscus\.repo/);
  assert.match(help, /--ttl and config\.defaultTtlDays must be finite positive integers/);
  assert.match(help, /--trusted-html accepts only content you trust/);
});

test("every command help page includes its tested example and effect markers", async () => {
  for (const command of COMMAND_KNOWLEDGE) {
    const help = await captureHelp(["help", command.name]);
    assert.match(help, /Workflow:/);
    assert.match(help, /Local write:/);
    assert.match(help, /External write:/);
    assert.match(help, /Destructive:/);
    for (const example of command.examples) assert.ok(help.includes(example));
  }
});

test("TTL help contract is enforced by the CLI parser", async () => {
  for (const command of ["deploy", "publish"]) {
    for (const invalid of [
      "0",
      "-1",
      "1.5",
      "12days",
      "Infinity",
      "NaN",
      String(Number.MAX_SAFE_INTEGER),
    ]) {
      const subject = command === "deploy" ? "example" : "example.md";
      const result = await captureFailure([command, subject, "--ttl", invalid]);
      assert.match(result, /must be a finite positive integer/);
    }
  }
});

test("publication privacy disclosure is snapshot-stable and present in both publishing commands", async () => {
  assert.equal(
    PUBLICATION_PRIVACY_DISCLOSURE,
    "Public deployment: the URL path is hard to guess and marked noindex, but the backing " +
      "GitHub repository is public. Repository visitors can enumerate document folders and " +
      "manifest metadata. Keep sensitive plans local.",
  );
  for (const command of ["deploy", "publish"]) {
    assert.ok((await captureHelp(["help", command])).includes(PUBLICATION_PRIVACY_DISCLOSURE));
  }
});

test("README, write-plan, and plugin metadata are projections of command knowledge", () => {
  const readme = fs.readFileSync(path.join(ROOT, "README.md"), "utf8");
  assert.equal(markedBlock(readme).trim(), renderReadmeCliReference());

  const skill = fs.readFileSync(path.join(ROOT, "skills", "write-plan", "SKILL.md"), "utf8");
  assert.equal(markedBlock(skill).trim(), renderSkillDiscoveryReference());
  const skillMetadata = matter(skill).data as Record<string, unknown>;
  assert.deepEqual(Object.keys(skillMetadata).sort(), ["description", "name"]);
  assert.equal(skillMetadata.name, "write-plan");
  assert.match(String(skillMetadata.description), /substantial/);

  const plugin = JSON.parse(
    fs.readFileSync(path.join(ROOT, ".codex-plugin", "plugin.json"), "utf8"),
  ) as { interface: { defaultPrompt: string[] } };
  assert.deepEqual(plugin.interface.defaultPrompt, PLUGIN_DEFAULT_PROMPTS);
});

test("distribution exposes one semantic skill and no retired wrappers", () => {
  const skills = fs
    .readdirSync(path.join(ROOT, "skills"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  assert.deepEqual(skills, ["write-plan"]);
  const commandsDir = path.join(ROOT, "commands");
  if (fs.existsSync(commandsDir)) assert.deepEqual(fs.readdirSync(commandsDir), []);

  const shippedFiles = [
    "README.md",
    "package.json",
    ".codex-plugin/plugin.json",
    ".claude-plugin/plugin.json",
    "hooks/hooks.json",
    "skills/write-plan/SKILL.md",
    "skills/write-plan/agents/openai.yaml",
    "src/application.ts",
    "src/program.ts",
  ];
  const shippedText = shippedFiles
    .map((file) => fs.readFileSync(path.join(ROOT, file), "utf8"))
    .join("\n");
  for (const retired of ["save-doc", "planloft-preview", "planloft-copy", "planloft-deploy"]) {
    assert.doesNotMatch(shippedText, new RegExp(retired));
  }
  assert.match(shippedText, /write-plan/);
});

async function captureHelp(args: string[]): Promise<string> {
  let output = "";
  const program = createProgram();
  program.exitOverride();
  program.configureOutput({
    writeOut: (value) => (output += value),
    writeErr: (value) => (output += value),
  });
  try {
    await program.parseAsync(["node", "planloft", ...args]);
  } catch (error) {
    if ((error as { code?: string }).code !== "commander.helpDisplayed") throw error;
  }
  return output;
}

async function captureFailure(args: string[]): Promise<string> {
  let output = "";
  const program = createProgram();
  program.exitOverride();
  program.configureOutput({
    writeOut: (value) => (output += value),
    writeErr: (value) => (output += value),
  });
  await assert.rejects(program.parseAsync(["node", "planloft", ...args]));
  return output;
}

function markedBlock(content: string): string {
  const match = content.match(
    /<!-- planloft:command-knowledge:start -->\n([\s\S]*?)\n<!-- planloft:command-knowledge:end -->/,
  );
  assert.ok(match?.[1]);
  return match[1];
}
