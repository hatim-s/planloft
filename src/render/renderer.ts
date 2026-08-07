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
    robots,
    comments,
  });
  const withRobots =
    robots && !layout.includes("{{robots}}") ? injectHeadMetadata(rendered, robots) : rendered;
  const html =
    comments && !layout.includes("{{comments}}")
      ? injectComments(withRobots, comments)
      : withRobots;
  return injectThemeSupport(html, styles, layout.includes("{{styles}}"));
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
.planloft-theme-toggle {
  position: fixed;
  z-index: 1000;
  top: 0.75rem;
  right: 0.75rem;
  border: 1px solid ButtonBorder;
  border-radius: 999px;
  padding: 0.4rem 0.7rem;
  background: Canvas;
  color: CanvasText;
  font: 600 0.75rem/1.2 system-ui, sans-serif;
  cursor: pointer;
}
.planloft-theme-toggle:focus-visible { outline: 2px solid Highlight; outline-offset: 2px; }
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

const THEME_TOGGLE = `<button class="planloft-theme-toggle" type="button" aria-label="Toggle color theme">Theme: system</button>
<script>
(() => {
  const root = document.documentElement;
  const button = document.querySelector(".planloft-theme-toggle");
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const key = "planloft-color-scheme";
  let saved = null;
  try { saved = localStorage.getItem(key); } catch {}
  if (saved === "light" || saved === "dark") root.dataset.planloftColorScheme = saved;
  const update = () => {
    const selected = root.dataset.planloftColorScheme;
    const effective = selected || (media.matches ? "dark" : "light");
    button.textContent = selected ? \`Theme: \${effective}\` : \`Theme: system (\${effective})\`;
    button.setAttribute("aria-pressed", selected ? "true" : "false");
  };
  button.addEventListener("click", () => {
    const current = root.dataset.planloftColorScheme || (media.matches ? "dark" : "light");
    const next = current === "dark" ? "light" : "dark";
    root.dataset.planloftColorScheme = next;
    try { localStorage.setItem(key, next); } catch {}
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
