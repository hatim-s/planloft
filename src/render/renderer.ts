import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { marked, Renderer } from "marked";
import { ingestDocument } from "../core/ingest.js";
import { readLayout, readStyle } from "./themes.js";
import type { CanonicalDocument, DocMeta } from "../core/types.js";

export interface RenderOptions {
  comments?: boolean;
  noindex?: boolean;
}

export interface BuildOpts extends RenderOptions {
  doc: DocMeta;
  theme: string;
  base: string; // kept for interface compatibility; the artifact is self-contained
}

/** Render a canonical document into a self-contained HTML artifact (ADR-0007). */
export function renderDocument(
  doc: CanonicalDocument,
  theme: string,
  options: RenderOptions = {},
): string {
  const body =
    doc.contentFormat === "html" ? doc.content : renderMarkdown(doc.content, doc.trustedHtml);

  return renderLayout(readLayout(theme), {
    title: escapeHtml(doc.title),
    kind: escapeHtml(doc.kind),
    body,
    styles: readStyle(theme),
    robots: options.noindex
      ? '\n<meta name="robots" content="noindex, nofollow" />'
      : "",
    comments: options.comments
      ? '\n<section class="planloft-comments"><!-- TODO(impl) mount giscus. --></section>'
      : "",
  });
}

/** Render an indexed store document to a temporary directory for preview/deploy. */
export function buildSite(opts: BuildOpts): string {
  const raw = fs.readFileSync(opts.doc.file, "utf8");
  const canonical = ingestDocument(raw, {
    format: opts.doc.format,
    sourceName: opts.doc.file,
    trustedHtml: opts.doc.trustedHtml ?? true,
    overrides: {
      title: opts.doc.title,
      slug: opts.doc.slug,
      kind: opts.doc.kind,
      theme: opts.doc.theme,
      status: opts.doc.status,
    },
  });
  const html = renderDocument(canonical, opts.theme, opts);
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "planloft-build-"));
  fs.writeFileSync(path.join(outDir, "index.html"), html);
  return outDir;
}

function renderMarkdown(content: string, trustedHtml: boolean): string {
  const renderer = new Renderer();
  if (!trustedHtml) {
    renderer.html = (html) => escapeHtml(html);
    renderer.link = (href, title, text) => {
      if (!safeUrl(href)) return text;
      const titleAttr = title ? ` title="${escapeHtml(title)}"` : "";
      return `<a href="${escapeHtml(href)}"${titleAttr}>${text}</a>`;
    };
    renderer.image = (href, title, text) => {
      if (!safeUrl(href)) return escapeHtml(text);
      const titleAttr = title ? ` title="${escapeHtml(title)}"` : "";
      return `<img src="${escapeHtml(href)}" alt="${escapeHtml(text)}"${titleAttr}>`;
    };
  }
  return marked.parse(content, { renderer }) as string;
}

function renderLayout(layout: string, slots: Record<string, string>): string {
  return layout.replace(/\{\{(title|kind|body|styles|robots|comments)\}\}/g, (_, key: string) => {
    return slots[key] ?? "";
  });
}

function safeUrl(url: string): boolean {
  const normalized = url.trim().toLowerCase();
  return (
    normalized.startsWith("http://") ||
    normalized.startsWith("https://") ||
    normalized.startsWith("mailto:") ||
    normalized.startsWith("#") ||
    normalized.startsWith("/") ||
    normalized.startsWith("./") ||
    normalized.startsWith("../")
  );
}

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};
function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ESCAPES[character] ?? character);
}
