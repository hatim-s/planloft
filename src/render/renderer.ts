import fs from "node:fs";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { marked, Renderer } from "marked";
import { parse, type DefaultTreeAdapterTypes } from "parse5";
import { PROSE_CSS } from "./prose.js";
import { componentStyles } from "../components/styles.js";
import { ingestDocument } from "../core/ingest.js";
import { CONTROLS_CSS, CONTROLS_MARKUP, LAYOUT_CSS } from "./controls.js";
import { readStyle, validateTheme } from "./themes.js";
import { validateGiscusConfig } from "../core/giscus.js";
import type { CanonicalDocument, DocMeta, GiscusConfig } from "../core/types.js";

class RenderSupportError extends Error {
  readonly code = "PLANLOFT_RENDER_SUPPORT_CONFLICT";
  constructor(detail: string) {
    super(`PLANLOFT_RENDER_SUPPORT_CONFLICT: ${detail} Regenerate from the original source, or review legacy generated support in a separate candidate before migrating.`);
    this.name = "RenderSupportError";
  }
}

class UnsupportedHtmlStructureError extends Error {
  readonly code = "PLANLOFT_HTML_FRAMESET_UNSUPPORTED";
  constructor() {
    super("PLANLOFT_HTML_FRAMESET_UNSUPPORTED: Frameset HTML is not supported. Convert it to a document with an ordinary body, or keep the original externally.");
    this.name = "UnsupportedHtmlStructureError";
  }
}

export interface RenderOptions {
  comments?: GiscusConfig;
  noindex?: boolean;
  /** Pre-rendered trusted body, used by the MDX compiler. */
  bodyHtml?: string;
  extraStyles?: string;
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
  validateTheme(theme);
  if (doc.contentFormat === "html") {
    if (options.comments) throw new Error("Comments cannot be added to authored HTML.");
    return injectSupport(doc.content, `${readStyle(theme)}\n${PROSE_CSS}\n${componentStyles}`, options.noindex);
  }
  if (doc.contentFormat === "mdx" && options.bodyHtml === undefined) throw new Error("MDX requires renderMdxDocument.");
  const body = options.bodyHtml ?? renderMarkdown(doc.content, doc.trustedHtml);
  const comments = options.comments ? renderGiscus(options.comments) : "";
  const shell = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(doc.title)}</title>
</head>
<body data-planloft-kind="${escapeHtml(doc.kind)}">
<main class="planloft-plan">
<article class="planloft-prose">${body}</article>${comments}
</main>
</body>
</html>
`;
  return injectSupport(shell, `${readStyle(theme)}\n${PROSE_CSS}\n${options.extraStyles ?? componentStyles}`, options.noindex);

}

function renderGiscus(config: GiscusConfig): string {
  const validated = validateGiscusConfig(config);
  const attributes: Record<string, string> = {
    src: "https://giscus.app/client.js",
    "data-repo": validated.repo,
    "data-repo-id": validated.repoId,
    "data-category": validated.category,
    "data-category-id": validated.categoryId,
    "data-mapping": "pathname",
    "data-strict": "1",
    "data-reactions-enabled": "1",
    "data-emit-metadata": "0",
    "data-input-position": "bottom",
    "data-theme": "preferred_color_scheme",
    "data-lang": "en",
    "data-loading": "lazy",
    crossorigin: "anonymous",
  };
  const rendered = Object.entries(attributes)
    .map(([name, value]) => `${name}="${escapeHtml(value)}"`)
    .join("\n  ");
  return `\n<section class="planloft-comments" aria-label="Comments">\n<script\n  ${rendered}\n  async>\n</script>\n</section>`;
}

/** Render an indexed store document to a temporary directory for preview/deploy. */
export function buildSite(opts: BuildOpts): string {
  const bytes = fs.readFileSync(opts.doc.file);
  const raw = opts.doc.format === "html"
    ? new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes)
    : bytes.toString("utf8");
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

type HtmlNode = DefaultTreeAdapterTypes.Node;
type HtmlComment = DefaultTreeAdapterTypes.CommentNode;

// Only replace complete blocks that the compiler owns. Parsing supplies real tag
// offsets, so strings in scripts and comments cannot become insertion points.
function injectSupport(input: string, css: string, noindex = false): string {
  const inspect = (html: string) => {
    const document = parse(html, { sourceCodeLocationInfo: true });
    const markers: HtmlComment[] = [];
    const elements: DefaultTreeAdapterTypes.Element[] = [];
    const visit = (node: HtmlNode) => {
      if ("tagName" in node) {
        elements.push(node);
        if ("content" in node) visit(node.content);
      }
      if ("data" in node && node.data.trim().startsWith("planloft-render:")) markers.push(node);
      if ("childNodes" in node) for (const child of node.childNodes) visit(child);
    };
    visit(document);
    return { markers, elements, document };
  };
  const ownedRanges = (input: string) => {
    const found = inspect(input);
    if (found.elements.some((element) => element.tagName === "frameset")) throw new UnsupportedHtmlStructureError();
    const ranges: { start: number; end: number }[] = [];
    for (const name of ["head", "controls"] as const) {
      const markers = found.markers.filter((node) => node.data.trim().startsWith(`planloft-render:${name}`));
      if (markers.length === 0) continue;
      if (markers.length !== 2) throw new RenderSupportError("Invalid Planloft render markers.");
      const [start, end] = markers.sort((a, b) => (a.sourceCodeLocation?.startOffset ?? 0) - (b.sourceCodeLocation?.startOffset ?? 0));
      if (!start?.sourceCodeLocation || !end?.sourceCodeLocation || input.slice(start.sourceCodeLocation.startOffset, start.sourceCodeLocation.endOffset) !== `<!-- planloft-render:${name}:start -->` ||
          input.slice(end.sourceCodeLocation.startOffset, end.sourceCodeLocation.endOffset) !== `<!-- planloft-render:${name}:end -->` ||
          start.data !== ` planloft-render:${name}:start ` || end.data !== ` planloft-render:${name}:end `) throw new RenderSupportError("Invalid Planloft render markers.");
      const content = input.slice(start.sourceCodeLocation.endOffset, end.sourceCodeLocation.startOffset);
      const headMatch = name === "head" ? /^\n<style data-planloft-render data-planloft-sha256="([a-f0-9]{64})">((?:(?!<\/style)[\s\S])*)<\/style>\n(<meta name="robots" content="noindex, nofollow" \/>\n)?$/.exec(content) : null;
      const headStyle = name === "head" && found.elements.find((element) =>
        element.tagName === "style" && element.sourceCodeLocation?.startOffset === start.sourceCodeLocation!.endOffset + 1 &&
        element.parentNode && "tagName" in element.parentNode && element.parentNode.tagName === "head",
      );
      const controlsParent = end.parentNode;
      const controlsBody = controlsParent && "tagName" in controlsParent && controlsParent.tagName === "body";
      const implicitBody = controlsBody && !controlsParent.sourceCodeLocation?.startTag;
      const startParent = start.parentNode;
      const validStartParent = startParent && (startParent.nodeName === "#document" || ("tagName" in startParent && (startParent.tagName === "html" || startParent.tagName === "head")));
      const controlElement = found.elements.find((element) => element.sourceCodeLocation?.startOffset === start.sourceCodeLocation!.endOffset + 1 && element.parentNode === controlsParent && element.attrs.some((attr) => attr.name === "class" && attr.value.split(/\s+/).includes("planloft-controls")));
      const validControls = content === `\n${CONTROLS_MARKUP}\n` && controlsBody && !!controlElement && (start.parentNode === end.parentNode || (implicitBody && validStartParent));
      const validHead = headMatch && headStyle && hashSupport(`${headMatch[2]}\n${headMatch[3] ?? ""}`) === headMatch[1];
      if (name === "controls" ? !validControls : !validHead) throw new RenderSupportError("Invalid Planloft render block.");
      ranges.push({ start: start.sourceCodeLocation.startOffset, end: end.sourceCodeLocation.endOffset });
    }
    if (found.markers.length !== ranges.length * 2 || (ranges.length !== 0 && ranges.length !== 2)) throw new RenderSupportError("Invalid Planloft render markers.");
    if (ranges.length === 2 && ranges[0]!.start < ranges[1]!.end && ranges[1]!.start < ranges[0]!.end) throw new RenderSupportError("Invalid Planloft render markers.");
    for (const element of found.elements) {
      const loc = element.sourceCodeLocation;
      if (!loc || ranges.some((range) => loc.startOffset >= range.start && loc.endOffset <= range.end)) continue;
      if (element.attrs.some((attr) => attr.name === "data-planloft-render" || attr.name === "data-planloft-theme-option" || attr.name === "data-planloft-layout-option" || attr.name === "data-planloft-layout-selector") || element.attrs.some((attr) => attr.name === "class" && attr.value.split(/\s+/).includes("planloft-controls"))) throw new RenderSupportError("Planloft render controls collide with authored HTML.");
    }
    return { ranges, ...found };
  };
  const { ranges } = ownedRanges(input);
  let html = input;
  for (const range of ranges.sort((a, b) => b.start - a.start)) html = html.slice(0, range.start) + html.slice(range.end);
  const { elements, document } = inspect(html);
  const head = elements.find((node) => node.tagName === "head" && node.sourceCodeLocation?.startTag);
  const body = elements.find((node) => node.tagName === "body" && node.sourceCodeLocation?.startTag);
  const root = elements.find((node) => node.tagName === "html" && node.sourceCodeLocation?.startTag);
  const doctype = document.childNodes.find((node) => node.nodeName === "#documentType");
  const headOffset = head?.sourceCodeLocation?.startTag?.endOffset ?? root?.sourceCodeLocation?.startTag?.endOffset ?? doctype?.sourceCodeLocation?.endOffset ?? 0;
  const parsedBody = elements.find((node) => node.tagName === "body");
  const firstBodyChild = parsedBody?.childNodes.find((node) => node.sourceCodeLocation)?.sourceCodeLocation?.startOffset;
  const bodyOffset = body?.sourceCodeLocation?.startTag?.endOffset ?? firstBodyChild ?? root?.sourceCodeLocation?.endTag?.startOffset ?? html.length;
  const safeCss = `${css}\n${CONTROLS_CSS}${LAYOUT_CSS}`.replace(/<\/style/gi, "<\\/style");
  const robots = noindex ? '<meta name="robots" content="noindex, nofollow" />\n' : "";
  const digest = hashSupport(`${safeCss}\n${robots}`);
  const headBlock = `<!-- planloft-render:head:start -->\n<style data-planloft-render data-planloft-sha256="${digest}">${safeCss}</style>\n${robots}<!-- planloft-render:head:end -->`;
  const controlsBlock = `<!-- planloft-render:controls:start -->\n${CONTROLS_MARKUP}\n<!-- planloft-render:controls:end -->`;
  const inserts = [{ offset: bodyOffset, text: controlsBlock }, { offset: headOffset, text: headBlock }].sort((a, b) => b.offset - a.offset);
  for (const insertion of inserts) html = html.slice(0, insertion.offset) + insertion.text + html.slice(insertion.offset);
  if (ownedRanges(html).ranges.length !== 2) throw new RenderSupportError("Cannot inject Planloft support into this HTML structure.");
  return html;
}

// This checksum detects accidental edits; it does not authenticate the author.
function hashSupport(value: string): string {
  return createHash("sha256").update(value).digest("hex");
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

/** Build stored MDX from its pinned bundle, keeping imports independent of the store path. */
export async function buildSiteAsync(opts: BuildOpts): Promise<string> {
  if (opts.doc.format !== "mdx") return buildSite(opts);
  const raw = fs.readFileSync(opts.doc.file, "utf8");
  const canonical = ingestDocument(raw, {
    format: "mdx", sourceName: opts.doc.file, trustedMdx: true,
    overrides: { title: opts.doc.title, slug: opts.doc.slug, kind: opts.doc.kind, theme: opts.doc.theme, status: opts.doc.status },
  });
  const { renderCompiledMdx } = await import("../mdx/index.js");
  const html = await renderCompiledMdx(canonical, opts.theme, fs.readFileSync(`${opts.doc.file}.bundle.js`, "utf8"), opts);
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "planloft-build-"));
  fs.writeFileSync(path.join(outDir, "index.html"), html);
  return outDir;
}
