// Generic Markdown typography. Themes supply only colour and type tokens; this sheet
// turns them into readable long-form defaults for the semantic elements Markdown and
// MDX produce. It is scoped to `.planloft-prose`, which the renderer puts on the
// article for Markdown and MDX. Authored HTML never gets the class unless the author
// writes it, and nothing here reaches `html`, `body` or an element outside the scope,
// except the page shell rule, which matches only the renderer's own Markdown layout.
//
// Every selector sits inside `:where()`, so each rule has element specificity. The
// component sheet (single classes) and any authored CSS win ties without effort.
export const PROSE_CSS = String.raw`
body:where(:has(> .planloft-plan > .planloft-prose)) {
  margin: 0;
  background: var(--planloft-paper, Canvas);
  color: var(--planloft-ink, CanvasText);
  -webkit-text-size-adjust: 100%;
}
:where(.planloft-plan:has(> .planloft-prose)) { padding-block: 4.5rem 7rem; }
:where(.planloft-prose) {
  background: var(--planloft-paper, Canvas);
  color: var(--planloft-ink, CanvasText);
  font-family: var(--planloft-font-body, system-ui, sans-serif);
  font-size: var(--planloft-font-size, 17px);
  line-height: var(--planloft-line-height, 1.6);
  font-kerning: normal;
  text-rendering: optimizeLegibility;
  overflow-wrap: break-word;
}
:where(.planloft-prose) *, :where(.planloft-prose) *::before, :where(.planloft-prose) *::after { box-sizing: border-box; }
:where(.planloft-prose) > :first-child { margin-top: 0; }
:where(.planloft-prose) > :last-child { margin-bottom: 0; }

:where(.planloft-prose) :is(h1, h2, h3, h4, h5, h6) {
  color: var(--planloft-ink, CanvasText);
  font-family: var(--planloft-font-heading, var(--planloft-font-body, system-ui, sans-serif));
  font-weight: var(--planloft-heading-weight, 650);
  line-height: var(--planloft-heading-line-height, 1.2);
  letter-spacing: var(--planloft-heading-tracking, 0);
  text-wrap: balance;
  overflow-wrap: anywhere;
}
:where(.planloft-prose) h1 { margin: 0 0 0.6em; font-size: var(--planloft-h1-size, 2.2em); }
:where(.planloft-prose) h2 { margin: 1.8em 0 0.5em; font-size: var(--planloft-h2-size, 1.5em); }
:where(.planloft-prose) h3 { margin: 1.6em 0 0.45em; font-size: var(--planloft-h3-size, 1.18em); }
:where(.planloft-prose) h4 { margin: 1.5em 0 0.4em; font-size: 1em; }
:where(.planloft-prose) h5 { margin: 1.4em 0 0.35em; font-size: 1em; color: var(--planloft-muted, GrayText); }
:where(.planloft-prose) h6 { margin: 1.4em 0 0.35em; font-size: 1em; font-weight: 500; font-style: italic; color: var(--planloft-muted, GrayText); }
:where(.planloft-prose) :is(h1, h2, h3) + :is(h2, h3, h4) { margin-top: 0.8em; }
/* A linked heading keeps the heading's colour and carries a thin accent underline, so
   it reads as a link without hover; hover strengthens the line. */
:where(.planloft-prose) :is(h1, h2, h3, h4, h5, h6) a {
  color: inherit;
  text-decoration: underline;
  text-decoration-thickness: 0.06em;
  text-decoration-color: color-mix(in srgb, var(--planloft-accent, LinkText) 55%, transparent);
  text-underline-offset: 0.14em;
}
:where(.planloft-prose) :is(h1, h2, h3, h4, h5, h6) a:hover { text-decoration-color: var(--planloft-accent, LinkText); }
/* The paragraph after the title is the summary; it reads a step larger and quieter. */
:where(.planloft-prose) h1 + p { font-size: 1.12em; color: var(--planloft-muted, GrayText); }

:where(.planloft-prose) p { margin: 0 0 1.2em; text-wrap: pretty; }
:where(.planloft-prose) :is(ul, ol) { margin: 0 0 1.2em; padding-left: 1.6em; }
:where(.planloft-prose) li { margin: 0.3em 0; }
:where(.planloft-prose) li > p { margin-bottom: 0.6em; }
:where(.planloft-prose) li :is(ul, ol) { margin: 0.3em 0 0.4em; }
:where(.planloft-prose) li::marker { color: var(--planloft-muted, GrayText); }
:where(.planloft-prose) ul:has(> li > input[type="checkbox"]) { list-style: none; padding-left: 0.2em; }
:where(.planloft-prose) li > input[type="checkbox"] { margin: 0 0.55em 0 0; vertical-align: -0.1em; accent-color: var(--planloft-accent, currentColor); }
:where(.planloft-prose) dl { margin: 0 0 1.2em; }
:where(.planloft-prose) dt { font-weight: var(--planloft-heading-weight, 650); }
:where(.planloft-prose) dd { margin: 0 0 0.6em 1.6em; }

:where(.planloft-prose) a {
  color: var(--planloft-accent, LinkText);
  text-decoration: underline;
  text-decoration-thickness: 1px;
  text-decoration-color: color-mix(in srgb, currentColor 45%, transparent);
  text-underline-offset: 0.18em;
}
:where(.planloft-prose) a:hover { text-decoration-color: currentColor; }
:where(.planloft-prose) strong { font-weight: 700; }
:where(.planloft-prose) mark { padding: 0 0.15em; background: color-mix(in srgb, var(--planloft-caution, #b98100) 28%, var(--planloft-paper, Canvas)); color: inherit; }
:where(.planloft-prose) del { color: var(--planloft-muted, GrayText); }
:where(.planloft-prose) abbr[title] { text-decoration: underline dotted; text-underline-offset: 0.18em; }
:where(.planloft-prose) :is(sup, sub) { font-size: 0.78em; line-height: 0; }
:where(.planloft-prose) small { font-size: 0.86em; }

:where(.planloft-prose) :is(code, kbd, samp, pre) {
  font-family: var(--planloft-font-mono, ui-monospace, Menlo, Consolas, monospace);
  font-size: var(--planloft-code-size, 0.88em);
}
:where(.planloft-prose) code {
  padding: 0.1em 0.3em;
  border-radius: 3px;
  background: var(--planloft-code-paper, color-mix(in srgb, CanvasText 7%, Canvas));
  color: var(--planloft-code-ink, inherit);
}
:where(.planloft-prose) pre {
  margin: 1.4em 0;
  padding: 0.95em 1.1em;
  overflow-x: auto;
  border-radius: 4px;
  background: var(--planloft-code-paper, color-mix(in srgb, CanvasText 7%, Canvas));
  color: var(--planloft-code-ink, inherit);
  line-height: 1.55;
  tab-size: 2;
}
:where(.planloft-prose) pre code { padding: 0; border-radius: 0; background: transparent; color: inherit; font-size: 1em; }
:where(.planloft-prose) kbd {
  padding: 0.05em 0.4em;
  border: 1px solid var(--planloft-rule, color-mix(in srgb, CanvasText 18%, Canvas));
  border-bottom-width: 2px;
  border-radius: 4px;
  background: var(--planloft-surface, color-mix(in srgb, CanvasText 5%, Canvas));
  font-size: 0.82em;
}

:where(.planloft-prose) blockquote {
  margin: 1.4em 0;
  padding: 0.1em 0 0.1em 1.1em;
  border-left: 3px solid var(--planloft-rule, color-mix(in srgb, CanvasText 18%, Canvas));
  color: var(--planloft-muted, GrayText);
}
:where(.planloft-prose) blockquote > :last-child { margin-bottom: 0; }
:where(.planloft-prose) blockquote cite { font-style: normal; }

/* Tables keep their natural width and scroll sideways instead of breaking the page. */
:where(.planloft-prose) table {
  display: block;
  width: max-content;
  max-width: 100%;
  margin: 1.4em 0;
  overflow-x: auto;
  border-collapse: collapse;
  line-height: 1.45;
  font-size: 0.94em;
}
:where(.planloft-prose) :is(th, td) {
  padding: 0.45em 1.1em 0.45em 0;
  border-bottom: 1px solid var(--planloft-rule, color-mix(in srgb, CanvasText 18%, Canvas));
  text-align: left;
  vertical-align: top;
}
:where(.planloft-prose) tr > :last-child { padding-right: 0; }
:where(.planloft-prose) thead th { font-weight: var(--planloft-heading-weight, 650); border-bottom: 2px solid var(--planloft-ink, CanvasText); }
:where(.planloft-prose) tbody th { font-weight: 600; }
:where(.planloft-prose) td:has(> :is(code, kbd):only-child) { white-space: nowrap; }

:where(.planloft-prose) hr { height: 0; margin: 2.8em 0; border: 0; border-top: 1px solid var(--planloft-rule, color-mix(in srgb, CanvasText 18%, Canvas)); }
:where(.planloft-prose) img, :where(.planloft-prose) video, :where(.planloft-prose) svg:not(.pl-chart__svg) { max-width: 100%; height: auto; }
:where(.planloft-prose) figure { margin: 1.6em 0; }
:where(.planloft-prose) figcaption { margin-top: 0.5em; color: var(--planloft-muted, GrayText); font-size: 0.9em; }
:where(.planloft-prose) details {
  margin: 1.2em 0;
  padding: 0.6em 0.9em;
  border: 1px solid var(--planloft-rule, color-mix(in srgb, CanvasText 18%, Canvas));
  border-radius: 4px;
}
:where(.planloft-prose) summary { cursor: pointer; font-weight: 600; }
:where(.planloft-prose) details[open] > summary { margin-bottom: 0.5em; }

:where(.planloft-prose) ::selection { background: color-mix(in srgb, var(--planloft-accent, Highlight) 24%, transparent); }
:where(.planloft-prose) :focus-visible { outline: 2px solid var(--planloft-accent, currentColor); outline-offset: 3px; }
:where(.planloft-plan) > .planloft-comments {
  margin-top: 4rem;
  padding-top: 2rem;
  border-top: 1px solid var(--planloft-rule, color-mix(in srgb, CanvasText 18%, Canvas));
}

@media (max-width: 40rem) {
  :where(.planloft-plan:has(> .planloft-prose)) { padding-block: 4.25rem 5rem; }
  :where(.planloft-prose) { font-size: calc(var(--planloft-font-size, 17px) * 0.94); }
  :where(.planloft-prose) h1 { font-size: calc(var(--planloft-h1-size, 2.2em) * 0.82); }
}
@media print {
  :where(.planloft-plan:has(> .planloft-prose)) { padding-block: 0; }
  :where(.planloft-prose) { font-size: 11pt; }
  :where(.planloft-prose) a { text-decoration-color: currentColor; }
  :where(.planloft-prose) :is(pre, blockquote, table, figure) { break-inside: avoid; }
}
`;
