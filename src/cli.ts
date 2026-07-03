#!/usr/bin/env node
import { Command } from "commander";
import { resolve } from "./commands/resolve.js";
import { list } from "./commands/list.js";
import { preview } from "./commands/preview.js";
import { copy } from "./commands/copy.js";
import { deploy } from "./commands/deploy.js";
import { rm } from "./commands/rm.js";
import { config } from "./commands/config.js";
import { init } from "./commands/init.js";
import { hook } from "./commands/hook.js";

const program = new Command();
program
  .name("planloft")
  .description("Hoist Claude Code plans into a global, themed, deployable store.")
  .version("0.0.1");

program
  .command("resolve")
  .description("Resolve target path/kind/theme/template for the current project (used by the skills).")
  .option("--slug <slug>", "kebab-case doc slug")
  .option("--title <title>", "human doc title")
  .option("--kind <kind>", "plan | adr | review | research | report | note | <custom>", "plan")
  .action((o) => resolve(o));

program
  .command("list")
  .description("List docs grouped by project.")
  .option("--kind <kind>", "filter by kind")
  .action((o) => list(o));

program
  .command("preview [slug]")
  .description("Build + open a themed preview locally.")
  .action((s) => preview(s));

program
  .command("copy [slug]")
  .description("Copy a plan's raw source into ./.planloft/plans/.")
  .action((s) => copy(s));

program
  .command("deploy [slug]")
  .description("Build + publish a plan as a shareable review link.")
  .option("--host <host>", "github | vercel", "github")
  .option("--ttl <days>", "GitHub Pages expiry in days", (v) => parseInt(v, 10))
  .option("--comments", "enable giscus review comments")
  .action((s, o) => deploy(s, { host: o.host, ttl: o.ttl, comments: o.comments }));

program.command("rm <slug>").description("Remove a plan from the store.").action((s) => rm(s));
program.command("config").description("Open the global config in $EDITOR.").action(() => config());
program.command("init").description("Optional setup: config + host readiness check.").action(() => init());

// Hidden dispatcher invoked by hooks/hooks.json.
program.command("__hook", { hidden: true }).action(() => hook());

program.parseAsync(process.argv);
