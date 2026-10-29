import { catalogAnchor, type CatalogEntry } from "./catalog.js";

export interface GalleryTheme {
  name: string;
  /** Output paths relative to the gallery root. */
  specimenPath: string;
  componentsPath: string;
  htmlPath: string;
}

export interface GallerySources {
  /** The shared long-form MDX every theme renders. */
  specimen: string;
  /** The authored HTML body every theme restyles. */
  html: string;
}

// Display names and one line on the identity. The theme id stays the config value.
const THEME_NOTES: Record<string, { title: string; note: string; face: string }> = {
  minimal: { title: "Plain text", note: "Monospace text with Gill Sans headings, graphite ink and indigo links. Space to read code and prose.", face: '"Gill Sans", Seravek, "Segoe UI", sans-serif' },
  detailed: { title: "Slate", note: "PT Sans text and DIN headings on blueprint-grey paper, with drawing-blue links. For specs and figures.", face: '"DIN Alternate", Bahnschrift, "Arial Narrow", sans-serif' },
  decision: { title: "Violet", note: "Seravek text, bold Futura headings and violet ink. Clear signposts for a decision and its reasoning.", face: 'Futura, "Century Gothic", "Avenir Next", sans-serif' },
  research: { title: "Journal", note: "PT Serif text with quiet Avenir headings, pale blue-grey paper and Prussian blue links. Built for close reading.", face: '"PT Serif", Charter, Cambria, Georgia, serif' },
  editorial: { title: "Folio", note: "Baskerville at 19px on stone-white paper, with madder red links. Large, regular-weight headings for a long read.", face: 'Baskerville, "Hoefler Text", "Palatino Linotype", Georgia, serif' },
  briefing: { title: "Marigold", note: "Avenir text with bold condensed headlines, navy ink and amber links. A brief for ten minutes.", face: '"Avenir Next Condensed", "Bahnschrift SemiCondensed", "Arial Narrow", sans-serif' },
};

export function galleryPage(themes: readonly GalleryTheme[], catalog: readonly CatalogEntry[], sources: GallerySources): string {
  const first = themes[0];
  if (!first) throw new Error("The gallery needs at least one bundled theme with a style.css.");
  const componentCount = new Set(catalog.flatMap((entry) => entry.components)).size;

  const cards = themes.map((theme) => {
    const note = THEME_NOTES[theme.name];
    return `<li class="g-card">
  <a class="g-card__link" href="${theme.specimenPath}" target="g-preview" data-page="${theme.specimenPath}">
    <span class="g-card__thumb" aria-hidden="true"><iframe src="${theme.specimenPath}" loading="lazy" tabindex="-1" title=""></iframe></span>
    <span class="g-card__name"${note ? ` style="font-family: ${escapeHtml(note.face)}"` : ""}>${escapeHtml(note?.title ?? theme.name)}</span>
    <span class="g-card__id"><code>theme: ${escapeHtml(theme.name)}</code></span>
    <span class="g-card__use">${escapeHtml(note?.note ?? "")}</span>
  </a>
  <span class="g-card__views">
    <a href="${theme.specimenPath}" target="g-preview" data-page="${theme.specimenPath}">Long form</a>
    <a href="${theme.componentsPath}" target="g-preview" data-page="${theme.componentsPath}">Components</a>
    <a href="${theme.htmlPath}" target="g-preview" data-page="${theme.htmlPath}">Authored HTML</a>
  </span>
</li>`;
  });

  const label = (theme: GalleryTheme) => THEME_NOTES[theme.name]?.title ?? theme.name;
  const specimenLinks = themes.map((theme) => navLink(theme.specimenPath, label(theme)));
  const componentLinks = themes.map((theme) => navLink(theme.componentsPath, label(theme)));
  const htmlLinks = themes.map((theme) => navLink(theme.htmlPath, label(theme)));
  const componentIndex = catalog.map((entry) => {
    const href = `${first.componentsPath}#${catalogAnchor(entry.name)}`;
    return `<li><a href="${href}" target="g-preview" data-page="${first.componentsPath}" data-anchor="${catalogAnchor(entry.name)}">${escapeHtml(entry.name)}</a><span>${inlineCode(escapeHtml(entry.summary))}</span></li>`;
  });

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex, nofollow" />
<title>Planloft themes</title>
<style>${GALLERY_CSS}</style>
</head>
<body>
<header class="g-head">
  <p class="g-mark">Planloft</p>
  <h1>Themes</h1>
  <p class="g-lede">${themes.length} themes, each a palette and a type setting. The same long-form document, the same ${componentCount} built-in components and the same hand-built HTML page are rendered in every one, so what differs is the theme. Preview on a phone, tablet or desktop, in light or dark, at reading width or full width.</p>
</header>

<section class="g-themes" aria-labelledby="g-themes-title">
  <h2 id="g-themes-title" class="g-section-title">Themes</h2>
  <ul class="g-cards">
${cards.join("\n")}
  </ul>
</section>

<section class="g-workspace" id="g-viewer" aria-label="Preview">
  <nav class="g-nav" aria-label="Gallery pages">
    <h2>Long form</h2>
    <ul>${specimenLinks.join("")}</ul>
    <h2>Components</h2>
    <ul>${componentLinks.join("")}</ul>
    <h2>Authored HTML</h2>
    <ul>${htmlLinks.join("")}</ul>
    <h2>Component index</h2>
    <ul class="g-index">${componentIndex.join("")}</ul>
  </nav>
  <div class="g-viewer">
    <div class="g-toolbar" hidden>
      <div class="g-segment" role="group" aria-label="Preview appearance">
        <button type="button" data-scheme="system" aria-pressed="true">System</button>
        <button type="button" data-scheme="light" aria-pressed="false">Light</button>
        <button type="button" data-scheme="dark" aria-pressed="false">Dark</button>
      </div>
      <div class="g-segment" role="group" aria-label="Page width">
        <button type="button" data-layout="reading" aria-pressed="true">Reading</button>
        <button type="button" data-layout="full" aria-pressed="false">Full width</button>
      </div>
      <div class="g-segment" role="group" aria-label="Preview device">
        <button type="button" data-width="full" aria-pressed="true">Desktop</button>
        <button type="button" data-width="tablet" aria-pressed="false">Tablet</button>
        <button type="button" data-width="phone" aria-pressed="false">Phone</button>
      </div>
      <a class="g-open" href="${first.specimenPath}" target="_blank" rel="noopener">Open page in a new tab</a>
    </div>
    <div class="g-stage" data-width="full">
      <iframe name="g-preview" title="Page preview" src="${first.specimenPath}"></iframe>
    </div>
    <div class="g-sources">
      <details class="g-source">
        <summary>Source of the long-form document (MDX, the same for every theme)</summary>
        <pre><code>${escapeHtml(sources.specimen)}</code></pre>
      </details>
      <details class="g-source">
        <summary>Source of the authored HTML page (its own layout, reads the theme tokens)</summary>
        <pre><code>${escapeHtml(sources.html)}</code></pre>
      </details>
    </div>
  </div>
</section>
<script>${GALLERY_SCRIPT}</script>
</body>
</html>
`;
}

function navLink(page: string, label: string): string {
  return `<li><a href="${page}" target="g-preview" data-page="${page}">${escapeHtml(label)}</a></li>`;
}

/** Catalog summaries use Markdown code spans; the index page is plain HTML. */
function inlineCode(html: string): string {
  return html.replace(/`([^`]+)`/g, "<code>$1</code>");
}

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ESCAPES[character] ?? character);
}

const GALLERY_CSS = `
:root {
  color-scheme: light dark;
  --g-ink: #17181a;
  --g-muted: #5d6066;
  --g-paper: #f4f5f3;
  --g-card: #ffffff;
  --g-rule: #dcdedb;
  --g-focus: #1f5fd6;
  font: 16px/1.55 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}
@media (prefers-color-scheme: dark) {
  :root {
    --g-ink: #e8e9e7;
    --g-muted: #9a9ea4;
    --g-paper: #111214;
    --g-card: #1a1b1e;
    --g-rule: #2c2e32;
    --g-focus: #7aa7ff;
  }
}
*, *::before, *::after { box-sizing: border-box; }
body { margin: 0; background: var(--g-paper); color: var(--g-ink); }
a { color: inherit; }
:focus-visible { outline: 2px solid var(--g-focus); outline-offset: 2px; }
code { font: 0.9em ui-monospace, "SF Mono", Menlo, Consolas, monospace; }

.g-head { padding: 3.5rem clamp(1.25rem, 5vw, 4rem) 1.5rem; max-width: 62rem; }
.g-mark { margin: 0; color: var(--g-muted); font-weight: 600; }
.g-head h1 { margin: 0.1rem 0 0.75rem; font-size: clamp(2.4rem, 6vw, 3.6rem); line-height: 1; letter-spacing: -0.035em; }
.g-lede { margin: 0; max-width: 46rem; color: var(--g-muted); font-size: 1.08rem; text-wrap: pretty; }

.g-themes { padding: 1rem clamp(1.25rem, 5vw, 4rem) 2.5rem; }
.g-section-title { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
.g-cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 21rem), 1fr));
  gap: 1.75rem 1.25rem;
  margin: 0;
  padding: 0;
  list-style: none;
}
.g-card { position: relative; display: grid; gap: 0.4rem; }
.g-card__link { display: grid; gap: 0.15rem; text-decoration: none; }
.g-card__thumb {
  position: relative;
  display: block;
  aspect-ratio: 4 / 3;
  margin-bottom: 0.6rem;
  overflow: hidden;
  border: 1px solid var(--g-rule);
  border-radius: 10px;
  background: var(--g-card);
  transition: border-color 120ms ease, transform 160ms ease;
}
.g-card__thumb iframe {
  position: absolute;
  top: 0;
  left: 0;
  width: 250%;
  height: 250%;
  border: 0;
  transform: scale(0.4);
  transform-origin: 0 0;
  pointer-events: none;
}
.g-card__link:hover .g-card__thumb { border-color: var(--g-muted); transform: translateY(-2px); }
.g-card__link[aria-current="page"] .g-card__thumb { border-color: var(--g-ink); box-shadow: 0 0 0 1px var(--g-ink); }
.g-card__name { font-size: 1.5rem; font-weight: 600; line-height: 1.15; }
.g-card__id { color: var(--g-muted); font-size: 0.85rem; }
.g-card__use { color: var(--g-muted); font-size: 0.92rem; }
.g-card__views { display: flex; flex-wrap: wrap; gap: 0.25rem 1rem; font-size: 0.88rem; }
.g-card__views a[aria-current="page"] { font-weight: 600; text-decoration-thickness: 2px; }

.g-workspace {
  display: grid;
  grid-template-columns: minmax(14rem, 17rem) minmax(0, 1fr);
  gap: 0;
  border-top: 1px solid var(--g-rule);
}
.g-nav {
  position: sticky;
  top: 0;
  align-self: start;
  max-height: 100vh;
  overflow-y: auto;
  padding: 1.5rem 1.25rem 2rem clamp(1.25rem, 5vw, 4rem);
  font-size: 0.92rem;
}
.g-nav h2 { margin: 1.4rem 0 0.4rem; color: var(--g-muted); font-size: 0.8rem; font-weight: 600; }
.g-nav h2:first-child { margin-top: 0; }
.g-nav ul { margin: 0; padding: 0; list-style: none; }
.g-nav li { margin: 0; }
.g-nav a {
  display: block;
  margin: 0 -0.5rem;
  padding: 0.25rem 0.5rem;
  border-radius: 6px;
  text-decoration: none;
}
.g-nav a:hover { background: color-mix(in srgb, var(--g-ink) 7%, transparent); }
.g-nav a[aria-current="page"] { background: var(--g-ink); color: var(--g-paper); }
.g-index li { display: grid; margin-bottom: 0.35rem; }
.g-index span { color: var(--g-muted); font-size: 0.82rem; line-height: 1.4; }
.g-index span { display: none; }

.g-viewer { min-width: 0; padding: 1.25rem clamp(1rem, 3vw, 2rem) 3rem; border-left: 1px solid var(--g-rule); }
.g-toolbar {
  position: sticky;
  top: 0;
  z-index: 2;
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem 1.25rem;
  align-items: center;
  margin: -1.25rem calc(-1 * clamp(1rem, 3vw, 2rem)) 1rem;
  padding: 0.75rem clamp(1rem, 3vw, 2rem);
  border-bottom: 1px solid var(--g-rule);
  background: color-mix(in srgb, var(--g-paper) 92%, transparent);
  -webkit-backdrop-filter: blur(8px);
  backdrop-filter: blur(8px);
}
.g-toolbar[hidden] { display: none; }
.g-segment { display: inline-flex; padding: 2px; border: 1px solid var(--g-rule); border-radius: 8px; background: var(--g-card); }
.g-segment button {
  padding: 0.3rem 0.75rem;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--g-muted);
  font: inherit;
  font-size: 0.88rem;
  cursor: pointer;
}
.g-segment button:hover { color: var(--g-ink); }
.g-segment button:disabled { color: color-mix(in srgb, var(--g-muted) 55%, transparent); cursor: not-allowed; }
.g-segment button:disabled[aria-pressed="true"] { background: color-mix(in srgb, var(--g-ink) 35%, transparent); color: var(--g-paper); }
.g-segment button[aria-pressed="true"] { background: var(--g-ink); color: var(--g-paper); }
.g-open { margin-left: auto; color: var(--g-muted); font-size: 0.88rem; }

.g-stage { margin-inline: auto; transition: max-width 160ms ease; }
.g-stage[data-width="tablet"] { max-width: 820px; }
.g-stage[data-width="phone"] { max-width: 390px; }
.g-stage iframe {
  display: block;
  width: 100%;
  height: max(36rem, calc(100vh - 7rem));
  border: 1px solid var(--g-rule);
  border-radius: 10px;
  background: var(--g-card);
}
.g-sources { margin-top: 1rem; }
.g-source { margin: 0.5rem 0; }
.g-source summary { color: var(--g-muted); font-size: 0.9rem; cursor: pointer; }
.g-source pre {
  max-height: 32rem;
  margin: 0.6rem 0 0;
  padding: 1rem 1.15rem;
  overflow: auto;
  border: 1px solid var(--g-rule);
  border-radius: 10px;
  background: var(--g-card);
  font-size: 0.84rem;
  line-height: 1.55;
  tab-size: 2;
}

@media (min-width: 72rem) {
  .g-index span { display: block; }
}
@media (max-width: 52rem) {
  .g-workspace { grid-template-columns: minmax(0, 1fr); }
  .g-nav { position: static; max-height: none; padding: 1.25rem clamp(1.25rem, 5vw, 4rem) 0.5rem; }
  .g-nav ul { display: flex; flex-wrap: wrap; gap: 0.25rem 0.75rem; }
  .g-nav a { margin: 0; }
  .g-viewer { border-left: 0; border-top: 1px solid var(--g-rule); }
  .g-open { margin-left: 0; }
}
@media (prefers-reduced-motion: reduce) {
  .g-card__thumb, .g-stage { transition: none; }
  .g-card__link:hover .g-card__thumb { transform: none; }
}
`;

// Links work without this script: each targets the preview frame by name. The script
// adds what plain links cannot: current-page marking and the appearance, page-width
// and device controls, which stay hidden until it runs. Page width presses the
// previewed page's own control, so the preview shows exactly what a reader gets; an
// authored HTML page has no width control, and the width button then has nothing to
// press. Appearance is a preview-only choice: pressing the page's colour control would
// save it for every page on this origin, including the documents the gallery links to.
const GALLERY_SCRIPT = `
(() => {
  const frame = document.querySelector('iframe[name="g-preview"]');
  const stage = document.querySelector(".g-stage");
  const toolbar = document.querySelector(".g-toolbar");
  const open = document.querySelector(".g-open");
  const links = Array.from(document.querySelectorAll("a[data-page]"));
  const viewer = document.getElementById("g-viewer");
  let scheme = "system";
  let layout = "reading";
  toolbar.hidden = false;

  const pageOf = (href) => new URL(href, location.href).pathname;
  const select = (link) => {
    const page = pageOf(link.href);
    for (const other of links) {
      if (pageOf(other.href) === page && !other.dataset.anchor) other.setAttribute("aria-current", "page");
      else other.removeAttribute("aria-current");
    }
    open.href = link.href;
  };
  // Same-origin previews get the page's own width control pressed and its colour
  // attribute set, so the page and its toggles agree. A file:// preview is
  // cross-origin; it follows the frame's colour scheme and keeps the width the page
  // last stored.
  const press = (selector) => {
    try {
      const option = frame.contentDocument?.querySelector(selector);
      if (option && option.getAttribute("aria-pressed") !== "true") option.click();
    } catch {}
  };
  const applyScheme = () => {
    frame.style.colorScheme = scheme === "system" ? "" : scheme;
    try {
      const page = frame.contentDocument;
      if (!page) return;
      if (scheme === "system") delete page.documentElement.dataset.planloftColorScheme;
      else page.documentElement.dataset.planloftColorScheme = scheme;
      for (const option of page.querySelectorAll("[data-planloft-theme-option]")) {
        option.setAttribute("aria-pressed", String(option.dataset.planloftThemeOption === scheme));
      }
    } catch {}
  };
  const applyLayout = () => press('[data-planloft-layout-option="' + layout + '"]');
  // A freshly loaded page shows the width its reader last chose, and the reader can
  // press the page's own control inside the preview; the toolbar follows both rather
  // than overwriting the choice. The page's button handler runs before this document
  // listener, so the pressed state is already current when it reads it.
  // A page without a width control (authored HTML, or a layout the contract does not
  // reach) leaves the segment disabled; the chosen width is kept and pressed again on
  // the next page that supports it.
  const syncLayout = () => {
    let supported = false;
    try {
      const group = frame.contentDocument?.querySelector("[data-planloft-layout-selector]");
      supported = !!group && !group.hidden;
      const pressed = supported ? group.querySelector('[data-planloft-layout-option][aria-pressed="true"]') : null;
      if (pressed) layout = pressed.dataset.planloftLayoutOption;
    } catch {}
    for (const button of document.querySelectorAll("[data-layout]")) {
      button.setAttribute("aria-pressed", String(button.dataset.layout === layout));
      button.disabled = !supported;
    }
    document.querySelector("[data-layout]").closest(".g-segment").title = supported ? "" : "This page has no width control";
  };

  for (const link of links) link.addEventListener("click", () => {
    select(link);
    if (link.closest(".g-cards")) viewer.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  });
  const showScheme = () => {
    for (const button of document.querySelectorAll("[data-scheme]")) button.setAttribute("aria-pressed", String(button.dataset.scheme === scheme));
  };
  for (const button of document.querySelectorAll("[data-scheme]")) button.addEventListener("click", () => {
    scheme = button.dataset.scheme;
    showScheme();
    applyScheme();
  });
  for (const button of document.querySelectorAll("[data-layout]")) button.addEventListener("click", () => {
    layout = button.dataset.layout;
    for (const other of document.querySelectorAll("[data-layout]")) other.setAttribute("aria-pressed", String(other === button));
    applyLayout();
  });
  for (const button of document.querySelectorAll("[data-width]")) button.addEventListener("click", () => {
    stage.dataset.width = button.dataset.width;
    for (const other of document.querySelectorAll("[data-width]")) other.setAttribute("aria-pressed", String(other === button));
  });
  frame.addEventListener("load", () => {
    applyScheme();
    applyLayout();
    syncLayout();
    try {
      frame.contentDocument?.addEventListener("click", (event) => {
        if (event.target.closest?.("[data-planloft-layout-option]")) syncLayout();
        // The reader chose a colour inside the page, which the page saves as usual.
        const option = event.target.closest?.("[data-planloft-theme-option]");
        if (option) {
          scheme = option.dataset.planloftThemeOption;
          showScheme();
          applyScheme();
        }
      });
    } catch {}
  });
  select(links.find((link) => pageOf(link.href) === pageOf(frame.src)) ?? links[0]);
})();
`;
