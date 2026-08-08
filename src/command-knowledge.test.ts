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
  renderCommandExample,
  renderReadmeCliExamples,
  renderReadmeCliReference,
  renderSkillDiscoveryReference,
} from "./command-knowledge.js";
import { createProgram } from "./program.js";
import type { PlanloftApplication } from "./application.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const EXPECTED_CONTRACT_CASES = [
  "command knowledge covers every public command with examples and effects",
  "source metadata and copy replacement flags are exposed by the CLI",
  "root help groups every public command and explains state and safety",
  "every command help page includes its tested example and effect markers",
  "every structured example reaches the expected application operation and normalized inputs",
  "unknown example options fail parsing before any application operation",
  "TTL help contract is enforced by the CLI parser",
  "publication privacy disclosure is snapshot-stable and present in both publishing commands",
  "README, write-plan, and plugin metadata are projections of command knowledge",
  "distribution exposes one semantic skill and no retired wrappers",
] as const;
const registeredContractCases: string[] = [];

function contractTest(name: string, run: () => void | Promise<void>): void {
  assert.ok(
    (EXPECTED_CONTRACT_CASES as readonly string[]).includes(name),
    `unexpected command-knowledge contract case: ${name}`,
  );
  registeredContractCases.push(name);
  test(name, run);
}

contractTest("command knowledge covers every public command with examples and effects", () => {
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

contractTest("source metadata and copy replacement flags are exposed by the CLI", () => {
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

contractTest("root help groups every public command and explains state and safety", async () => {
  const help = await captureHelp(["--help"]);
  for (const category of COMMAND_CATEGORIES) assert.match(help, new RegExp(category));
  for (const command of COMMAND_KNOWLEDGE) assert.ok(help.includes(command.signature));
  assert.match(help, /source -> canonical document -> store/);
  assert.match(help, /publish: source -> store -> artifact -> GitHub Pages/);
  assert.match(help, /deploy:  stored document -> public GitHub Pages artifact/);
  assert.ok(help.includes(PUBLICATION_PRIVACY_DISCLOSURE));
  assert.match(help, /rm deletes stored source/);
  assert.match(help, /--comments requires GitHub Discussions plus giscus\.repo/);
  assert.match(help, /--ttl and config\.defaultTtlDays must be finite positive integers/);
  assert.match(help, /--trusted-html accepts only content you trust/);
});

contractTest("every command help page includes its tested example and effect markers", async () => {
  for (const command of COMMAND_KNOWLEDGE) {
    const help = await captureHelp(["help", command.name]);
    assert.match(help, /Workflow:/);
    assert.match(help, /Local write:/);
    assert.match(help, /External write:/);
    assert.match(help, /Destructive:/);
    for (const example of command.examples) {
      assert.ok(help.includes(renderCommandExample(example)));
    }
  }
});

contractTest("every structured example reaches the expected application operation and normalized inputs", async () => {
  const expected: Record<
    string,
    {
      method: string;
      args: readonly unknown[];
      environment?: Readonly<Record<string, string>>;
      preconditions?: readonly string[];
    }
  > = {
    render: {
      method: "render",
      args: ["proposal.md", { theme: "editorial", out: "./proposal-site" }],
    },
    hoist: { method: "hoist", args: ["proposal.json", {}] },
    publish: { method: "publish", args: ["proposal.md", { ttl: 30 }] },
    list: { method: "list", args: [{ kind: "plan" }] },
    preview: { method: "preview", args: ["architecture-roadmap"] },
    copy: { method: "copy", args: ["architecture-roadmap", { force: undefined }] },
    deploy: {
      method: "deploy",
      args: ["architecture-roadmap", { ttl: 30, comments: undefined }],
    },
    rm: { method: "remove", args: ["obsolete-roadmap"] },
    resolve: {
      method: "resolve",
      args: [{ kind: "plan", slug: "auth-refactor", title: "Authentication Refactor" }],
    },
    config: { method: "config", args: [], environment: { EDITOR: "nano" } },
    init: { method: "init", args: [] },
  };

  for (const command of COMMAND_KNOWLEDGE) {
    const contract = expected[command.name];
    assert.ok(contract, `missing independent invocation expectation for ${command.name}`);
    assert.equal(command.examples.length, 1, `${command.name} should have one canonical example`);
    const example = command.examples[0];
    assert.ok(example);
    assert.deepEqual(example.environment, contract.environment);
    assert.deepEqual(example.preconditions, contract.preconditions);

    const calls: Array<{ method: string; args: unknown[] }> = [];
    const application = mockApplication(calls);
    const program = createProgram({
      application,
      writeOut: () => undefined,
      writeErr: () => undefined,
      setExitCode: () => undefined,
    });
    configureParserForTests(program);
    await program.parseAsync(["node", "planloft", ...example.argv]);
    assert.deepEqual(calls, [{ method: contract.method, args: contract.args }]);
  }
});

contractTest("unknown example options fail parsing before any application operation", async () => {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  let output = "";
  const program = createProgram({
    application: mockApplication(calls),
    writeOut: (value) => (output += value),
    writeErr: (value) => (output += value),
    setExitCode: () => undefined,
  });
  configureParserForTests(program, {
    writeOut: (value) => (output += value),
    writeErr: (value) => (output += value),
  });
  await assert.rejects(
    program.parseAsync(["node", "planloft", "render", "proposal.md", "--unknown-option"]),
    (error: unknown) =>
      (error as { code?: string }).code === "commander.unknownOption",
  );
  assert.match(output, /unknown option '--unknown-option'/);
  assert.deepEqual(calls, []);
});

contractTest("TTL help contract is enforced by the CLI parser", async () => {
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

contractTest("publication privacy disclosure is snapshot-stable and present in both publishing commands", async () => {
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

contractTest("README, write-plan, and plugin metadata are projections of command knowledge", () => {
  const readme = fs.readFileSync(path.join(ROOT, "README.md"), "utf8");
  assert.equal(markedBlock(readme, "command-knowledge").trim(), renderReadmeCliReference());
  assert.equal(markedBlock(readme, "command-examples").trim(), renderReadmeCliExamples());
  for (const example of renderReadmeCliExamples().split("\n")) {
    const command = example.split(/\s+/)[1];
    assert.ok(command);
    assert.ok(
      COMMAND_KNOWLEDGE.find((entry) => entry.name === command)?.examples.some(
        (entry) => renderCommandExample(entry) === example,
      ),
    );
  }

  const skill = fs.readFileSync(path.join(ROOT, "skills", "write-plan", "SKILL.md"), "utf8");
  assert.equal(
    normalizeMarkdownProjection(markedBlock(skill, "command-knowledge")),
    normalizeMarkdownProjection(renderSkillDiscoveryReference('"$PLANLOFT_COMMAND"')),
  );
  const skillMetadata = matter(skill).data as Record<string, unknown>;
  assert.deepEqual(Object.keys(skillMetadata).sort(), ["description", "name"]);
  assert.equal(skillMetadata.name, "write-plan");
  assert.match(String(skillMetadata.description), /substantial/);

  const plugin = JSON.parse(
    fs.readFileSync(path.join(ROOT, ".codex-plugin", "plugin.json"), "utf8"),
  ) as { interface: { defaultPrompt: string[] } };
  assert.deepEqual(plugin.interface.defaultPrompt, PLUGIN_DEFAULT_PROMPTS);
});

contractTest("distribution exposes one semantic skill and no retired wrappers", () => {
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

test("command knowledge meta-guard registers every expected named case", () => {
  assert.deepEqual(registeredContractCases, EXPECTED_CONTRACT_CASES);
});

async function captureHelp(args: string[]): Promise<string> {
  let output = "";
  const program = createProgram();
  const target =
    args.length === 1 && args[0] === "--help"
      ? program
      : args.length === 2 && args[0] === "help"
        ? program.commands.find((command) => command.name() === args[1])
        : undefined;
  assert.ok(target, `unsupported help capture arguments: ${args.join(" ")}`);
  target.configureOutput({
    writeOut: (value) => (output += value),
    writeErr: (value) => (output += value),
  });
  target.outputHelp();
  return output;
}

async function captureFailure(args: string[]): Promise<string> {
  let output = "";
  const program = createProgram();
  configureParserForTests(program, {
    writeOut: (value) => (output += value),
    writeErr: (value) => (output += value),
  });
  await assert.rejects(program.parseAsync(["node", "planloft", ...args]));
  return output;
}

function configureParserForTests(
  command: ReturnType<typeof createProgram>,
  output?: {
    writeOut: (value: string) => void;
    writeErr: (value: string) => void;
  },
): void {
  command.exitOverride();
  if (output) command.configureOutput(output);
  for (const child of command.commands) configureParserForTests(child, output);
}

function markedBlock(content: string, name: string): string {
  const match = content.match(
    new RegExp(`<!-- planloft:${name}:start -->\\n([\\s\\S]*?)\\n<!-- planloft:${name}:end -->`),
  );
  assert.ok(match?.[1]);
  return match[1];
}

function normalizeMarkdownProjection(content: string): string {
  return content.trim().replace(/\n {2}(?=\S)/g, " ");
}

function mockApplication(
  calls: Array<{ method: string; args: unknown[] }>,
): PlanloftApplication {
  return new Proxy({} as PlanloftApplication, {
    get: (_target, property) =>
      (...args: unknown[]) => {
        const method = String(property);
        calls.push({ method, args });
        return Promise.resolve(mockResult(method));
      },
  });
}

function mockResult(method: string): unknown {
  const deployment = {
    url: "https://example.test/p/example/",
    expiresAt: "2026-09-07T00:00:00.000Z",
    ttlDays: 30,
    warnings: [],
  };
  const document = {
    slug: "example",
    title: "Example",
    kind: "plan",
    format: "md",
    updatedAt: "2026-08-08T00:00:00.000Z",
    file: "/tmp/example.md",
  };
  switch (method) {
    case "render":
      return { operation: "render", output: "stdout", html: "" };
    case "hoist":
      return { operation: "hoist", document };
    case "publish":
      return { operation: "publish", document, deployment };
    case "resolve":
      return {
        operation: "resolve",
        context: {
          path: "/tmp/example.md",
          kind: "plan",
          format: "md",
          theme: "detailed",
          template: "# Plan",
        },
      };
    case "list":
      return { operation: "list", projects: [] };
    case "preview":
      return {
        operation: "preview",
        slug: "example",
        directory: "/tmp/example",
        url: "file:///tmp/example/index.html",
        opened: false,
      };
    case "copy":
      return {
        operation: "copy",
        slug: "example",
        path: "/tmp/example.md",
        relativePath: ".planloft/plans/example.md",
        usedCurrentDirectory: false,
        replaced: false,
      };
    case "deploy":
      return { operation: "deploy", slug: "example", deployment };
    case "remove":
      return { operation: "remove", slug: "example", sourceRemoved: true };
    case "config":
      return { operation: "config", mode: "edited", path: "/tmp/config.json" };
    case "init":
      return {
        operation: "init",
        configPath: "/tmp/config.json",
        configCreated: true,
        theme: "detailed",
        captureFormat: "md",
        defaultTtlDays: 30,
        github: { ready: false, repo: "planloft-plans" },
      };
    default:
      throw new Error(`Unexpected mock application method: ${method}`);
  }
}
