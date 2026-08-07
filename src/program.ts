import { Command, InvalidArgumentError } from "commander";
import { parseTtlDays, TTL_RULE } from "./core/ttl.js";
import {
  commandKnowledge,
  formatCommandHelp,
  formatRootWorkflowHelp,
} from "./command-knowledge.js";
import { resolve } from "./commands/resolve.js";
import { list } from "./commands/list.js";
import { preview } from "./commands/preview.js";
import { copy } from "./commands/copy.js";
import { deploy } from "./commands/deploy.js";
import { rm } from "./commands/rm.js";
import { config } from "./commands/config.js";
import { init } from "./commands/init.js";
import { hook } from "./commands/hook.js";
import { hoist } from "./commands/hoist.js";
import { render } from "./commands/render.js";
import { publish } from "./commands/publish.js";

export function createProgram(): Command {
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
    .option("--trusted-html", "allow trusted raw HTML input or embedded Markdown HTML")
    .option("--noindex", "include noindex/nofollow metadata")
    .action((input, options) => render(input, options));

  withKnowledge(program.command("hoist <input>"), "hoist")
    .option("--format <format>", "md | json | html (required for stdin)")
    .option("--title <title>", "override document title")
    .option("--slug <slug>", "override document slug")
    .option("--kind <kind>", "override document kind")
    .option("--theme <theme>", "override theme")
    .option("--trusted-html", "allow trusted raw HTML input or embedded Markdown HTML")
    .action((input, options) => hoist(input, options));

  withKnowledge(program.command("publish <input>"), "publish")
    .option("--format <format>", "md | json | html (required for stdin)")
    .option("--title <title>", "override document title")
    .option("--slug <slug>", "override document slug")
    .option("--kind <kind>", "override document kind")
    .option("--theme <theme>", "override theme")
    .option("--trusted-html", "allow trusted raw HTML input or embedded Markdown HTML")
    .option("--ttl <days>", "GitHub Pages expiry in days", positiveInteger)
    .option("--comments", "enable giscus review comments")
    .action((input, options) => publish(input, { ...options, ttl: options.ttl }));

  withKnowledge(program.command("resolve"), "resolve")
    .option("--slug <slug>", "kebab-case doc slug")
    .option("--title <title>", "human doc title")
    .option("--kind <kind>", "plan | adr | review | research | report | note | <custom>", "plan")
    .action((options) => resolve(options));

  withKnowledge(program.command("list"), "list")
    .option("--kind <kind>", "filter by kind")
    .action((options) => list(options));

  withKnowledge(program.command("preview [slug]"), "preview").action((slug) => preview(slug));

  withKnowledge(program.command("copy [slug]"), "copy").action((slug) => copy(slug));

  withKnowledge(program.command("deploy [slug]"), "deploy")
    .option("--ttl <days>", "GitHub Pages expiry in days", positiveInteger)
    .option("--comments", "enable giscus review comments")
    .action((slug, options) => deploy(slug, { ttl: options.ttl, comments: options.comments }));

  withKnowledge(program.command("rm <slug>"), "rm").action((slug) => rm(slug));
  withKnowledge(program.command("config"), "config").action(() => config());
  withKnowledge(program.command("init"), "init").action(() => init());

  // Hidden dispatcher invoked by hooks/hooks.json.
  program.command("__hook", { hidden: true }).action(() => hook());

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
