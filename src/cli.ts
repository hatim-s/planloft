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
import { hoist } from "./commands/hoist.js";
import { render } from "./commands/render.js";
import { publish } from "./commands/publish.js";

const program = new Command();
program
  .name("planloft")
  .description("Render, hoist, and publish consistently themed documents.")
  .version("0.0.1");

program
  .command("render <input>")
  .description("Render Markdown, JSON, or trusted HTML to a self-contained HTML artifact.")
  .option("--format <format>", "md | json | html (required for stdin)")
  .option("--out <path>", "output .html file or directory; defaults to stdout")
  .option("--title <title>", "override document title")
  .option("--slug <slug>", "override document slug")
  .option("--kind <kind>", "override document kind")
  .option("--theme <theme>", "override theme")
  .option("--trusted-html", "allow trusted raw HTML input or embedded Markdown HTML")
  .option("--noindex", "include noindex/nofollow metadata")
  .action((input, o) => render(input, o));

program
  .command("hoist <input>")
  .description("Normalize Markdown, JSON, or trusted HTML into the current project's store.")
  .option("--format <format>", "md | json | html (required for stdin)")
  .option("--title <title>", "override document title")
  .option("--slug <slug>", "override document slug")
  .option("--kind <kind>", "override document kind")
  .option("--theme <theme>", "override theme")
  .option("--trusted-html", "allow trusted raw HTML input or embedded Markdown HTML")
  .action((input, o) => hoist(input, o));

program
  .command("publish <input>")
  .description("Hoist + render + publish Markdown, JSON, or trusted HTML to GitHub Pages.")
  .option("--format <format>", "md | json | html (required for stdin)")
  .option("--title <title>", "override document title")
  .option("--slug <slug>", "override document slug")
  .option("--kind <kind>", "override document kind")
  .option("--theme <theme>", "override theme")
  .option("--trusted-html", "allow trusted raw HTML input or embedded Markdown HTML")
  .option("--ttl <days>", "GitHub Pages expiry in days", (value) => parseInt(value, 10))
  .option("--comments", "enable giscus review comments")
  .action((input, o) => publish(input, { ...o, ttl: o.ttl }));

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
  .description("Copy a document's raw source into ./.planloft/plans/.")
  .action((s) => copy(s));

program
  .command("deploy [slug]")
  .description("Build + publish a document to GitHub Pages as a shareable review link.")
  .option("--ttl <days>", "GitHub Pages expiry in days", (v) => parseInt(v, 10))
  .option("--comments", "enable giscus review comments")
  .action((s, o) => deploy(s, { ttl: o.ttl, comments: o.comments }));

program.command("rm <slug>").description("Remove a document from the store.").action((s) => rm(s));
program.command("config").description("Open the global config in $EDITOR.").action(() => config());
program.command("init").description("Optional setup: config + GitHub readiness check.").action(() => init());

// Hidden dispatcher invoked by hooks/hooks.json.
program.command("__hook", { hidden: true }).action(() => hook());

program.parseAsync(process.argv);
