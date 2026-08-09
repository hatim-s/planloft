import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { marked, Renderer } from "marked";
import { ingestDocument } from "../core/ingest.js";
import { readLayout, readStyle } from "./themes.js";
import { validateGiscusConfig } from "../core/giscus.js";
import type { CanonicalDocument, DocMeta, GiscusConfig } from "../core/types.js";

export interface RenderOptions {
  comments?: GiscusConfig;
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

  const layout = readLayout(theme);
  const styles = themeStyles(readStyle(theme));
  const comments = options.comments ? renderGiscus(options.comments) : "";
  const robots = options.noindex
    ? '\n<meta name="robots" content="noindex, nofollow" />'
    : "";
  const rendered = renderLayout(layout, {
    title: escapeHtml(doc.title),
    kind: escapeHtml(doc.kind),
    body,
    styles,
    // Metadata is injected after the document shell and all other render
    // support so it always lands in a real head, even for fragment layouts.
    robots: "",
    comments,
  });
  const structured = ensureDocumentStructure(rendered);
  const withComments =
    comments && !layout.includes("{{comments}}")
      ? injectComments(structured, comments)
      : structured;
  const themed = injectThemeSupport(withComments, styles, layout.includes("{{styles}}"));
  return robots ? injectHeadMetadata(themed, robots) : themed;
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

const THEME_SUPPORT_MARKER = "planloft-color-schemes: light dark";

const THEME_CONTROL_CSS = `
:root { color-scheme: light dark; }
.planloft-theme-selector {
  position: fixed;
  z-index: 1000;
  top: 0.75rem;
  right: 0.75rem;
  display: inline-flex;
  gap: 0.125rem;
  border: 1px solid ButtonBorder;
  border-radius: 999px;
  padding: 0.2rem;
  background: Canvas;
  color: CanvasText;
  box-shadow: 0 1px 3px color-mix(in srgb, CanvasText 14%, transparent);
}
.planloft-theme-option {
  display: inline-grid;
  width: 1.75rem;
  height: 1.75rem;
  place-items: center;
  border: 0;
  border-radius: 999px;
  padding: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
}
.planloft-theme-option[aria-pressed="true"] {
  background: SelectedItem;
  color: SelectedItemText;
}
.planloft-theme-option svg { width: 1rem; height: 1rem; pointer-events: none; }
.planloft-theme-option:focus-visible { outline: 2px solid Highlight; outline-offset: 2px; }
`;

const SYSTEM_DARK_FALLBACK_CSS = `
@media (prefers-color-scheme: dark) {
  :root:not([data-planloft-color-scheme="light"]) body {
    background: Canvas !important;
    color: CanvasText !important;
  }
}
:root[data-planloft-color-scheme="dark"] body {
  background: Canvas !important;
  color: CanvasText !important;
}
`;

const THEME_TOGGLE = `<div class="planloft-theme-selector planloft-theme-toggle" role="group" aria-label="Color theme">
  <button class="planloft-theme-option" type="button" data-planloft-theme-option="light" aria-label="Light theme" title="Light theme" aria-pressed="false">
    <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4" fill="currentColor"/><path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.66 6.34l1.41-1.41" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
  </button>
  <button class="planloft-theme-option" type="button" data-planloft-theme-option="dark" aria-label="Dark theme" title="Dark theme" aria-pressed="false">
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 14.2A8.5 8.5 0 0 1 9.8 3.5 8.5 8.5 0 1 0 20.5 14.2Z" fill="currentColor"/></svg>
  </button>
  <button class="planloft-theme-option" type="button" data-planloft-theme-option="system" aria-label="System theme" title="System theme" aria-pressed="true">
    <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="13" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 21h8M12 17v4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
  </button>
</div>
<script>
(() => {
  const root = document.documentElement;
  const options = Array.from(document.querySelectorAll("[data-planloft-theme-option]"));
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const key = "planloft-color-scheme";
  let saved = null;
  try { saved = localStorage.getItem(key); } catch {}
  let selected = saved === "light" || saved === "dark" ? saved : "system";
  const update = () => {
    if (selected === "system") delete root.dataset.planloftColorScheme;
    else root.dataset.planloftColorScheme = selected;
    const effective = selected === "system" ? (media.matches ? "dark" : "light") : selected;
    for (const option of options) {
      const optionName = option.dataset.planloftThemeOption;
      option.setAttribute("aria-pressed", String(optionName === selected));
      if (optionName === "system") option.title = \`System theme (currently \${effective})\`;
    }
  };
  for (const option of options) option.addEventListener("click", () => {
    selected = option.dataset.planloftThemeOption;
    try { localStorage.setItem(key, selected); } catch {}
    update();
  });
  media.addEventListener?.("change", update);
  update();
})();
</script>`;

function themeStyles(style: string): string {
  const fallback = style.includes(THEME_SUPPORT_MARKER) ? "" : SYSTEM_DARK_FALLBACK_CSS;
  return `${style}\n${fallback}${THEME_CONTROL_CSS}`;
}

function injectThemeSupport(html: string, styles: string, layoutIncludesStyles: boolean): string {
  const htmlWithToggle = injectThemeToggle(html);
  return layoutIncludesStyles ? htmlWithToggle : injectStyles(htmlWithToggle, styles);
}

function ensureDocumentStructure(html: string): string {
  const hasHtml = /<html\b[^>]*>/i.test(html);
  const hasHead = /<head\b[^>]*>/i.test(html);
  const hasBody = /<body\b[^>]*>/i.test(html);

  if (hasHtml) {
    if (hasHead) return html;
    const body = /<body\b[^>]*>/i.exec(html);
    if (body?.index !== undefined) {
      return `${html.slice(0, body.index)}<head></head>\n${html.slice(body.index)}`;
    }
    const root = /<html\b[^>]*>/i.exec(html);
    if (!root || root.index === undefined) return html;
    const insertion = root.index + root[0].length;
    return `${html.slice(0, insertion)}\n<head></head>${html.slice(insertion)}`;
  }

  if (hasBody) {
    return `<!doctype html>\n<html>\n${hasHead ? "" : "<head></head>\n"}${html}\n</html>`;
  }

  return `<!doctype html>\n<html>\n<head></head>\n<body>\n${html}\n</body>\n</html>`;
}

function injectStyles(html: string, styles: string): string {
  const styleElement = `<style>${styles}</style>`;
  const headEnd = /<\/head\s*>/i.exec(html);
  if (headEnd?.index !== undefined) {
    return `${html.slice(0, headEnd.index)}${styleElement}\n${html.slice(headEnd.index)}`;
  }
  const body = /<body\b[^>]*>/i.exec(html);
  if (body?.index !== undefined) {
    return `${html.slice(0, body.index)}${styleElement}\n${html.slice(body.index)}`;
  }
  return `${styleElement}\n${html}`;
}

function injectThemeToggle(html: string): string {
  const body = /<body\b[^>]*>/i.exec(html);
  if (!body || body.index === undefined) return `${THEME_TOGGLE}\n${html}`;
  const insertion = body.index + body[0].length;
  return `${html.slice(0, insertion)}\n${THEME_TOGGLE}${html.slice(insertion)}`;
}

function injectComments(html: string, comments: string): string {
  const bodyEnd = /<\/body\s*>/i.exec(html);
  if (bodyEnd?.index !== undefined) {
    return `${html.slice(0, bodyEnd.index)}${comments}\n${html.slice(bodyEnd.index)}`;
  }
  return `${html}${comments}`;
}

function injectHeadMetadata(html: string, metadata: string): string {
  const headEnd = /<\/head\s*>/i.exec(html);
  if (headEnd?.index !== undefined) {
    return `${html.slice(0, headEnd.index)}${metadata}\n${html.slice(headEnd.index)}`;
  }
  const body = /<body\b[^>]*>/i.exec(html);
  if (body?.index !== undefined) {
    return `${html.slice(0, body.index)}${metadata}\n${html.slice(body.index)}`;
  }
  return `${metadata}\n${html}`;
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
