import { Command, InvalidArgumentError } from "commander";
import pc from "picocolors";
import {
  createPlanloftApplication,
  PlanloftApplicationError,
  type ConfigResult,
  type CopyResult,
  type DeployResult,
  type HoistResult,
  type InitResult,
  type ListResult,
  type PlanloftApplication,
  type PreviewResult,
  type PublishResult,
  type RemoveResult,
  type RenderResult,
  type ResolveResult,
  type ApplicationOperation,
} from "./application.js";
import type { SourceFlags } from "./commands/source.js";
import { executeHook, type HookEvent, type HookResult } from "./hook.js";
import { parseTtlDays, TTL_RULE } from "./core/ttl.js";
import {
  commandKnowledge,
  formatCommandHelp,
  formatRootWorkflowHelp,
} from "./command-knowledge.js";

export interface CliAdapterOptions {
  application?: PlanloftApplication;
  writeOut?: (value: string) => void;
  writeErr?: (value: string) => void;
  setExitCode?: (code: number) => void;
  readStdin?: () => Promise<string>;
}

export function createProgram(options: CliAdapterOptions = {}): Command {
  const application = options.application ?? createPlanloftApplication();
  const writeOut = options.writeOut ?? ((value: string) => process.stdout.write(value));
  const writeErr = options.writeErr ?? ((value: string) => process.stderr.write(value));
  const setExitCode = options.setExitCode ?? ((code: number) => (process.exitCode = code));
  const stdin = options.readStdin ?? readStdin;
  const run = async <T>(
    operationName: ApplicationOperation,
    operation: () => Promise<T>,
    present: (result: T) => string,
  ): Promise<void> => {
    try {
      const output = present(await operation());
      if (output) writeOut(output);
    } catch (error) {
      const failure =
        error instanceof PlanloftApplicationError
          ? error
          : new PlanloftApplicationError("internal", operationName, errorMessage(error), { cause: error });
      writeErr(`${pc.red(operationLabel(failure.operation) + " failed: ")}${failure.message}\n`);
      setExitCode(1);
    }
  };

  const sourceOptions = async (input: string, parsed: SourceFlags): Promise<SourceFlags> => ({
    ...parsed,
    ...(input === "-" ? { stdin: await stdin() } : {}),
  });

  const program = new Command();
  program
    .name("planloft")
    .description("Render, store, and explicitly publish light/dark themed documents.")
    .version("0.0.1")
    .addHelpText("after", `\n${formatRootWorkflowHelp()}\n`);

  withKnowledge(program.command("render <input>"), "render")
    .option("--format <format>", "md | json | html (required for stdin)")
    .option("--out <path>", "output .html file or directory; defaults to stdout")
    .option("--title <title>", "override document title")
    .option("--slug <slug>", "override document slug")
    .option("--kind <kind>", "override document kind")
    .option("--theme <theme>", "override theme")
    .option("--status <status>", "override document status")
    .option("--trusted-html", "allow trusted raw HTML input or embedded Markdown HTML")
    .option("--noindex", "include noindex/nofollow metadata")
    .action(async (input, parsed) => {
      const flags = await sourceOptions(input, parsed);
      await run("render", () => application.render(input, flags), presentRender);
    });

  withKnowledge(program.command("hoist <input>"), "hoist")
    .option("--format <format>", "md | json | html (required for stdin)")
    .option("--title <title>", "override document title")
    .option("--slug <slug>", "override document slug")
    .option("--kind <kind>", "override document kind")
    .option("--theme <theme>", "override theme")
    .option("--status <status>", "override document status")
    .option("--trusted-html", "allow trusted raw HTML input or embedded Markdown HTML")
    .action(async (input, parsed) => {
      const flags = await sourceOptions(input, parsed);
      await run("hoist", () => application.hoist(input, flags), presentHoist);
    });

  withKnowledge(program.command("publish <input>"), "publish")
    .option("--format <format>", "md | json | html (required for stdin)")
    .option("--title <title>", "override document title")
    .option("--slug <slug>", "override document slug")
    .option("--kind <kind>", "override document kind")
    .option("--theme <theme>", "override theme")
    .option("--status <status>", "override document status")
    .option("--trusted-html", "allow trusted raw HTML input or embedded Markdown HTML")
    .option("--ttl <days>", "GitHub Pages expiry in days", positiveInteger)
    .option("--comments", "enable giscus review comments")
    .action(async (input, parsed) => {
      const flags = await sourceOptions(input, parsed);
      await run("publish", () => application.publish(input, flags), presentPublish);
    });

  withKnowledge(program.command("resolve"), "resolve")
    .option("--slug <slug>", "kebab-case doc slug")
    .option("--title <title>", "human doc title")
    .option("--kind <kind>", "plan | adr | review | research | report | note | <custom>", "plan")
    .action((parsed) => run("resolve", () => application.resolve(parsed), presentResolve));

  withKnowledge(program.command("list"), "list")
    .option("--kind <kind>", "filter by kind")
    .action((parsed) => run("list", () => application.list(parsed), presentList));

  withKnowledge(program.command("preview [slug]"), "preview").action((slug) =>
    run("preview", () => application.preview(slug), presentPreview),
  );

  withKnowledge(program.command("copy [slug]"), "copy")
    .option("--force", "replace an existing repository copy")
    .action((slug, parsed) =>
      run("copy", () => application.copy(slug, { force: parsed.force }), presentCopy),
    );

  withKnowledge(program.command("deploy [slug]"), "deploy")
    .option("--ttl <days>", "GitHub Pages expiry in days", positiveInteger)
    .option("--comments", "enable giscus review comments")
    .action((slug, parsed) =>
      run(
        "deploy",
        () => application.deploy(slug, { ttl: parsed.ttl, comments: parsed.comments }),
        presentDeploy,
      ),
    );

  withKnowledge(program.command("rm <slug>"), "rm").action((slug) =>
    run("remove", () => application.remove(slug), presentRemove),
  );
  withKnowledge(program.command("config"), "config").action(() =>
    run("config", () => application.config(), presentConfig),
  );
  withKnowledge(program.command("init"), "init").action(() =>
    run("init", () => application.init(), presentInit),
  );

  // Hidden protocol adapter invoked by hooks/hooks.json.
  program.command("__hook", { hidden: true }).action(async () => {
    let event: HookEvent;
    try {
      event = JSON.parse(await stdin()) as HookEvent;
    } catch {
      return;
    }
    await run("hook", () => Promise.resolve(executeHook(event)), presentHook);
  });

  return program;
}

function withKnowledge(command: Command, name: string): Command {
  return command
    .description(commandKnowledge(name).purpose)
    .addHelpText("after", `\n${formatCommandHelp(name)}\n`);
}

function positiveInteger(value: string): number {
  try {
    return parseTtlDays(value, "--ttl");
  } catch {
    throw new InvalidArgumentError(TTL_RULE);
  }
}

function presentRender(result: RenderResult): string {
  return result.output === "stdout"
    ? result.html
    : `${pc.green("Rendered: ")}${result.path}\n`;
}

function presentHoist(result: HoistResult): string {
  return (
    `${pc.green("Hoisted: ")}${result.document.file}\n` +
    `${JSON.stringify({ slug: result.document.slug, kind: result.document.kind, format: result.document.format })}\n`
  );
}

function presentPublish(result: PublishResult): string {
  return `${pc.green("Hoisted: ")}${result.document.file}\n${presentDeployment(result.deployment)}`;
}

function presentResolve(result: ResolveResult): string {
  return JSON.stringify(result.context, null, 2) + "\n";
}

function presentList(result: ListResult): string {
  if (result.projects.length === 0) {
    return pc.dim("No docs yet. Produce a plan/adr/research doc and planloft captures it.") + "\n";
  }
  return result.projects
    .map((project) => {
      const documents = project.documents.map((document) => {
        const kind = pc.magenta(`[${document.kind}]`.padEnd(11));
        return `  ${kind} ${pc.cyan(document.slug.padEnd(24))} ${pc.dim(document.format.padEnd(5))} ${document.title}`;
      });
      return [`${pc.bold(project.label)}${pc.dim(`  (${project.key})`)}`, ...documents].join("\n");
    })
    .join("\n") + "\n";
}

function presentPreview(result: PreviewResult): string {
  return `${pc.green("Built preview: ")}${result.directory}\n`;
}

function presentCopy(result: CopyResult): string {
  const notice = result.usedCurrentDirectory
    ? pc.yellow("Not in a Git repository; using the current directory as the copy root.") + "\n"
    : "";
  return `${notice}${pc.green("Copied ")}${result.relativePath}\n`;
}

function presentDeploy(result: DeployResult): string {
  return presentDeployment(result.deployment);
}

function presentDeployment(deployment: DeployResult["deployment"]): string {
  const warnings = deployment.warnings.map((warning) => pc.yellow(warning)).join("\n");
  return (
    `${pc.green("Deployed: ")}${deployment.url}\n` +
    `${pc.dim(`Expires at ${deployment.expiresAt} (${deployment.ttlDays} days; redeploy moves expiry forward).`)}\n` +
    `${warnings}${warnings ? "\n" : ""}` +
    `${pc.dim("GitHub Pages can take ~1 min to build on first deploy.")}\n`
  );
}

function presentRemove(result: RemoveResult): string {
  return `${pc.green(`Removed ${result.slug}.`)}\n`;
}

function presentConfig(result: ConfigResult): string {
  return result.mode === "edited"
    ? ""
    : `${result.path}\n${JSON.stringify(result.config, null, 2)}\n`;
}

function presentInit(result: InitResult): string {
  const configLine = result.configCreated
    ? `${pc.green("Wrote default config: ")}${result.configPath}`
    : `${pc.dim("Config exists: ")}${result.configPath}`;
  const readiness = result.github.ready
    ? pc.green("ready (preferred credential)")
    : pc.yellow(
        "not ready — deploy next checks PLANLOFT_GITHUB_TOKEN, github.token, then a TTY-only prompt",
      );
  return (
    `${configLine}\n` +
    `theme=${result.theme}  captureFormat=${result.captureFormat}  defaultTtlDays=${result.defaultTtlDays}\n` +
    `github (gh) : ${readiness}${pc.dim(`  repo=${result.github.repo}`)}\n`
  );
}

function presentHook(result: HookResult): string {
  return result.output ? JSON.stringify(result.output) + "\n" : "";
}

function operationLabel(operation: string): string {
  return operation === "remove"
    ? "Remove"
    : operation.charAt(0).toUpperCase() + operation.slice(1);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}
