import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { marked } from "marked";
import * as fm from "../core/frontmatter.js";
import { readStyle } from "./themes.js";
import type { DocMeta } from "../core/types.js";

export interface BuildOpts {
  doc: DocMeta;
  theme: string;
  base: string; // deploy URL base path; kept for interface compat, unused (page is self-contained)
  comments?: boolean; // giscus (ADR-0001 §D19)
  noindex?: boolean; // ADR-0001 §D21
}

/**
 * Render a single doc to a self-contained themed static site.
 * ADR-0003 (supersedes ADR-0001 §D10/§D25): pure JS — marked + gray-matter, inlined
 * theme CSS. No framework, no native binaries, no vendored node_modules, instant build.
 * Returns the absolute path to the output dir containing index.html.
 */
export function buildSite(opts: BuildOpts): string {
  const raw = fs.readFileSync(opts.doc.file, "utf8");
  const isHtml = opts.doc.format === "html"; // planFormat: html (ADR-0001 §D9)
  const { data, content } = isHtml ? { data: {} as fm.Frontmatter, content: raw } : fm.parse(raw);

  const title = opts.doc.title || data.title || "Doc";
  const body = isHtml ? content : (marked.parse(content) as string);
  const css = readStyle(opts.theme);

  const html = renderPage({
    title,
    body,
    css,
    noindex: !!opts.noindex,
    comments: !!opts.comments,
  });

  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "planloft-build-"));
  fs.writeFileSync(path.join(outDir, "index.html"), html);
  return outDir;
}

function renderPage(o: {
  title: string;
  body: string;
  css: string;
  noindex: boolean;
  comments: boolean;
}): string {
  const robots = o.noindex ? '\n<meta name="robots" content="noindex, nofollow" />' : "";
  const comments = o.comments
    ? '\n<section class="planloft-comments"><!-- TODO(impl) ADR-0001 §D19: mount giscus (repo/category from config). --></section>'
    : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />${robots}
<title>${escapeHtml(o.title)}</title>
<style>${o.css}</style>
</head>
<body>
<main class="planloft-plan">
<article>${o.body}</article>${comments}
</main>
</body>
</html>
`;
}

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c);
}
