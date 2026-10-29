import { badgeStyles } from "./badge.js";

// Styles for the built-in components, appended after the theme stylesheet.
//
// Components never hard-code a colour or a face. They read \`--pl-*\` tokens, and each
// token falls back from the theme's \`--planloft-*\` contract to system colours, so a
// page whose theme sets nothing still renders readably in light and dark. Shape
// (corner radius) is a component value, not a theme token.
//
// The aliases are declared on every component root, not on \`:root\`. A custom property
// resolves its var() references where it is declared, so a root alias would freeze the
// page-level value and a region that overrides \`--planloft-accent\` or
// \`--planloft-font-heading\` would never reach a component inside it. Declaring them on
// the component itself (and again on a nested component) resolves against whatever
// the enclosing region inherited.
//
// Selectors are single classes so they beat the prose sheet's element rules, while an
// author can still override a component with a more specific selector.
export const componentStyles = String.raw`
.pl-callout, .pl-stats, .pl-stat, .pl-status, .pl-badge, .pl-checklist, .pl-todo, .pl-timeline, .pl-milestone, .pl-chart, .pl-sparkline, .pl-table, .pl-scroll, .pl-tip {
  --pl-ink: var(--planloft-ink, CanvasText);
  --pl-paper: var(--planloft-paper, Canvas);
  --pl-muted: var(--planloft-muted, color-mix(in srgb, var(--pl-ink) 62%, var(--pl-paper)));
  --pl-surface: var(--planloft-surface, color-mix(in srgb, var(--pl-ink) 5%, var(--pl-paper)));
  --pl-rule: var(--planloft-rule, color-mix(in srgb, var(--pl-ink) 16%, var(--pl-paper)));
  --pl-accent: var(--planloft-accent, var(--pl-ink));
  --pl-accent-contrast: var(--planloft-accent-contrast, var(--pl-paper));
  --pl-series-1: var(--planloft-chart-1, #2a78d6);
  --pl-series-2: var(--planloft-chart-2, #eb6834);
  --pl-series-3: var(--planloft-chart-3, #1baf7a);
  --pl-series-4: var(--planloft-chart-4, #6250d6);
  --pl-series-5: var(--planloft-chart-5, #e87ba4);
  --pl-series-6: var(--planloft-chart-6, #eda100);
  --pl-sequential: var(--planloft-chart-sequential, var(--pl-series-1));
  --pl-neutral: var(--planloft-chart-neutral, color-mix(in srgb, var(--pl-ink) 52%, var(--pl-paper)));
  --pl-positive: var(--planloft-positive, #1f8a52);
  --pl-negative: var(--planloft-negative, #c8412b);
  --pl-caution: var(--planloft-caution, #b98100);
  --pl-font-body: var(--planloft-font-body, inherit);
  --pl-font-heading: var(--planloft-font-heading, var(--pl-font-body));
  --pl-font-mono: var(--planloft-font-mono, ui-monospace, Menlo, Consolas, monospace);
  --pl-heading-weight: var(--planloft-heading-weight, 650);
  --pl-radius: 6px;
}

.pl-sr {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
.pl-scroll { max-width: 100%; overflow-x: auto; }
.pl-scroll > table { display: table; width: 100%; max-width: none; margin: 0; overflow: visible; }
.pl-num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }

/* Callout */
.pl-callout {
  --pl-tone: var(--pl-accent);
  margin: 1.6em 0;
  padding: 0.85em 1.1em 0.9em;
  border-inline-start: 3px solid var(--pl-tone);
  border-radius: 0 var(--pl-radius) var(--pl-radius) 0;
  background: color-mix(in srgb, var(--pl-tone) 7%, var(--pl-paper));
}
.pl-callout[data-tone="note"] { --pl-tone: var(--pl-muted); }
.pl-callout[data-tone="tip"] { --pl-tone: var(--pl-positive); }
.pl-callout[data-tone="warning"] { --pl-tone: var(--pl-caution); }
.pl-callout[data-tone="risk"] { --pl-tone: var(--pl-negative); }
.pl-callout[data-tone="decision"] { --pl-tone: var(--pl-accent); }
.pl-callout__heading {
  font-family: var(--pl-font-heading);
  display: flex;
  flex-wrap: wrap;
  gap: 0.15em 0.6em;
  align-items: baseline;
  margin: 0 0 0.35em;
  line-height: 1.35;
}
.pl-callout__tone { font-weight: var(--pl-heading-weight); }
.pl-callout__title { font-weight: var(--pl-heading-weight); }
.pl-callout__body > :first-child { margin-top: 0; }
.pl-callout__body > :last-child { margin-bottom: 0; }

/* Stat and Stats */
.pl-stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 11.5rem), 1fr));
  gap: 1.25rem 2rem;
  margin: 1.75em 0;
}
.pl-stat { min-width: 0; padding-top: 0.7rem; border-top: 1px solid var(--pl-rule); }
.pl-stats > .pl-stat { margin: 0; }
.pl-stat__label { margin: 0; color: var(--pl-muted); font-size: 0.86em; line-height: 1.35; }
.pl-stat__value {
  font-family: var(--pl-font-heading);
  margin: 0.15rem 0 0.1rem;
  font-size: 2em;
  font-weight: var(--pl-heading-weight);
  line-height: 1.1;
  letter-spacing: -0.015em;
  overflow-wrap: anywhere;
}
.pl-stat__change { margin: 0; font-size: 0.86em; font-weight: 600; font-variant-numeric: tabular-nums; }
.pl-stat__change[data-assessment="good"] .pl-stat__arrow { color: var(--pl-positive); }
.pl-stat__change[data-assessment="bad"] .pl-stat__arrow { color: var(--pl-negative); }
.pl-stat__arrow { display: inline-block; margin-inline-end: 0.2em; }
.pl-stat__period { color: var(--pl-muted); font-weight: 400; }
.pl-stat .pl-sparkline { display: block; width: 6.5em; height: 1.6em; margin-top: 0.5rem; color: var(--pl-muted); }
.pl-stat__note { margin-top: 0.4rem; color: var(--pl-muted); font-size: 0.86em; }
.pl-stat__note > :first-child { margin-top: 0; }
.pl-stat__note > :last-child { margin-bottom: 0; }

/* Status */
.pl-status {
  --pl-tone: var(--pl-muted);
  display: inline-flex;
  align-items: center;
  gap: 0.4em;
  padding: 0.05em 0.6em 0.1em 0.5em;
  border: 1px solid color-mix(in srgb, var(--pl-tone) 45%, transparent);
  border-radius: 999px;
  background: color-mix(in srgb, var(--pl-tone) 10%, var(--pl-paper));
  color: var(--pl-ink);
  font-size: 0.82em;
  font-weight: 600;
  line-height: 1.5;
  white-space: nowrap;
  vertical-align: 0.08em;
}
.pl-status::before { color: var(--pl-tone); font-size: 0.85em; line-height: 1; }
.pl-status[data-tone="done"] { --pl-tone: var(--pl-positive); }
.pl-status[data-tone="done"]::before { content: "\2713"; }
.pl-status[data-tone="on-track"] { --pl-tone: var(--pl-positive); }
.pl-status[data-tone="on-track"]::before { content: "\25CF"; }
.pl-status[data-tone="at-risk"] { --pl-tone: var(--pl-caution); }
.pl-status[data-tone="at-risk"]::before { content: "\25B2"; }
.pl-status[data-tone="blocked"] { --pl-tone: var(--pl-negative); }
.pl-status[data-tone="blocked"]::before { content: "\25A0"; }
.pl-status[data-tone="not-started"]::before { content: "\25CB"; }

/* Todo and Checklist */
.pl-checklist { margin: 1.5em 0; }
.pl-checklist__title { margin: 0 0 0.35em; font-family: var(--pl-font-heading); font-weight: var(--pl-heading-weight); }
.pl-todo {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 0 0.7em;
  align-items: start;
  margin: 0;
  padding: 0.5em 0;
  border-bottom: 1px solid var(--pl-rule);
}
.pl-checklist > .pl-todo:first-of-type { border-top: 1px solid var(--pl-rule); }
/* Drawn by hand: a native disabled checkbox renders as a grey block that reads as
   checked. Checked is a filled inset square, legible in both modes and in print. */
.pl-todo__box {
  appearance: none;
  -webkit-appearance: none;
  display: grid;
  width: 1.05em;
  height: 1.05em;
  margin: 0.25em 0 0;
  border: 1.5px solid color-mix(in srgb, var(--pl-ink) 55%, var(--pl-paper));
  border-radius: 4px;
  background: var(--pl-paper);
  font: inherit;
}
.pl-todo__box:checked {
  border-color: var(--pl-accent);
  background: var(--pl-accent);
  box-shadow: inset 0 0 0 2.5px var(--pl-accent-contrast);
}
.pl-todo__box:disabled { border-style: dashed; }
.pl-todo__box:checked:disabled { border-style: solid; }
.pl-todo__box:not(:disabled) { cursor: pointer; }
.pl-todo__box:not(:disabled):hover { border-color: var(--pl-accent); }
.pl-todo__box:focus-visible { outline: 2px solid var(--pl-accent); outline-offset: 2px; }
.pl-todo__text { display: flex; flex-wrap: wrap; gap: 0.1em 1em; align-items: baseline; min-width: 0; }
.pl-todo__label { flex: 1 1 14em; overflow-wrap: anywhere; }
.pl-todo__box:not(:disabled) + .pl-todo__text .pl-todo__label { cursor: pointer; }
.pl-todo:has(.pl-todo__box:checked) .pl-todo__label {
  color: var(--pl-muted);
  text-decoration: line-through;
  text-decoration-thickness: 1px;
}
.pl-todo__meta {
  display: inline-flex;
  gap: 0.9em;
  color: var(--pl-muted);
  font-size: 0.86em;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.pl-todo__owner { font-weight: 600; }
.pl-todo__detail { flex-basis: 100%; color: var(--pl-muted); font-size: 0.92em; }
.pl-todo__detail > :first-child { margin-top: 0.2em; }
.pl-todo__detail > :last-child { margin-bottom: 0; }

/* Timeline and Milestone */
.pl-timeline { margin: 1.75em 0; padding: 0; list-style: none; }
.pl-milestone {
  --pl-tone: var(--pl-rule);
  position: relative;
  display: grid;
  grid-template-columns: 1.6rem minmax(0, 1fr);
  margin: 0;
  padding: 0 0 1.35em;
}
.pl-milestone::marker { content: none; }
.pl-milestone::before {
  content: "";
  position: absolute;
  top: 0.95em;
  bottom: -0.35em;
  left: calc(0.45rem - 0.5px);
  width: 1px;
  background: var(--pl-rule);
}
.pl-milestone:last-child { padding-bottom: 0; }
.pl-milestone:last-child::before { display: none; }
.pl-milestone[data-state="done"] { --pl-tone: var(--pl-accent); }
.pl-milestone[data-state="done"]::before { background: var(--pl-accent); }
.pl-milestone[data-state="active"] { --pl-tone: var(--pl-accent); }
.pl-milestone[data-state="blocked"] { --pl-tone: var(--pl-negative); }
.pl-milestone__node {
  position: relative;
  z-index: 1;
  width: 0.9rem;
  height: 0.9rem;
  margin-top: 0.3em;
  border: 2px solid var(--pl-tone);
  border-radius: 50%;
  background: var(--pl-paper);
}
.pl-milestone[data-state="done"] .pl-milestone__node { background: var(--pl-tone); }
.pl-milestone[data-state="active"] .pl-milestone__node {
  box-shadow: inset 0 0 0 2px var(--pl-paper), inset 0 0 0 5px var(--pl-tone);
}
.pl-milestone[data-state="blocked"] .pl-milestone__node { border-radius: 2px; background: var(--pl-tone); }
.pl-milestone__head { display: flex; flex-wrap: wrap; gap: 0 0.75em; align-items: baseline; grid-column: 2; }
.pl-milestone__date {
  flex-basis: 100%;
  color: var(--pl-muted);
  font-size: 0.82em;
  font-variant-numeric: tabular-nums;
  line-height: 1.5;
}
.pl-milestone__title { font-weight: var(--pl-heading-weight); line-height: 1.4; }
.pl-milestone__state { color: var(--pl-muted); font-size: 0.82em; }
.pl-milestone[data-state="active"] .pl-milestone__state,
.pl-milestone[data-state="blocked"] .pl-milestone__state { color: var(--pl-ink); font-weight: 600; }
.pl-milestone__body { grid-column: 2; margin-top: 0.25em; color: var(--pl-muted); }
.pl-milestone__body > :first-child { margin-top: 0; }
.pl-milestone__body > :last-child { margin-bottom: 0; }
@media (min-width: 48rem) {
  .pl-milestone { grid-template-columns: 7.5rem 1.6rem minmax(0, 1fr); }
  .pl-milestone::before { left: calc(7.5rem + 0.45rem - 0.5px); }
  .pl-milestone__node { grid-column: 2; grid-row: 1; }
  .pl-milestone__head { grid-column: 3; grid-row: 1; }
  .pl-milestone__date {
    position: absolute;
    left: 0;
    width: 6.75rem;
    padding-top: 0.1em;
    text-align: right;
  }
  .pl-milestone__body { grid-column: 3; }
}

/* Charts */
.pl-chart {
  margin: 2em 0;
  color: var(--pl-ink);
  font-family: var(--pl-font-body);
}
.pl-chart__title { margin: 0 0 0.6rem; font-family: var(--pl-font-heading); font-weight: var(--pl-heading-weight); line-height: 1.35; }
.pl-chart__plot { position: relative; container: pl-plot / inline-size; }
.pl-chart__frame { display: none; }
.pl-chart__frame[data-frame="compact"],
.pl-chart__frame[data-frame="fixed"] { display: block; }
@container pl-plot (min-width: 30rem) {
  .pl-chart__frame[data-frame="compact"] { display: none; }
  .pl-chart__frame[data-frame="regular"] { display: block; }
}
@container pl-plot (min-width: 56rem) {
  .pl-chart__frame[data-frame="regular"] { display: none; }
  .pl-chart__frame[data-frame="wide"] { display: block; }
}
.pl-chart__svg { display: block; width: 100%; height: auto; font-variant-numeric: tabular-nums; }
.pl-chart__caption {
  margin: 0.6rem 0 0;
  color: var(--pl-muted);
  font-size: 0.86em;
  line-height: 1.5;
}
.pl-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem 1.25rem;
  margin: 0 0 0.75rem;
  padding: 0;
  list-style: none;
  font-size: 0.86em;
  line-height: 1.4;
}
.pl-legend__item { display: inline-flex; gap: 0.45em; align-items: center; margin: 0; }
.pl-legend__item::marker { content: none; }
.pl-legend__value { color: var(--pl-muted); font-variant-numeric: tabular-nums; }
.pl-swatch { flex: none; display: inline-block; background: var(--pl-swatch); }
.pl-swatch--block { width: 0.75em; height: 0.75em; border-radius: 2px; }
.pl-swatch--line { width: 1.1em; height: 2px; border-radius: 1px; }

/* Pointer targets stay invisible; keyboard focus keeps an outline for navigation. */
.pl-chart__hits { fill: transparent; stroke: none; }
.pl-hit { outline: none; }
.pl-hit:focus-visible { stroke: var(--pl-ink); stroke-width: 1.5; }
/* Tooltip. A hairline and a short black shadow lift it off the chart; an ink-tinted
   shadow would glow in dark themes. A mark with its own colour gets a key swatch on
   the first row. Column hits cover every series and carry no colour. */
.pl-tip {
  position: fixed;
  z-index: 20;
  display: grid;
  gap: 0.1rem;
  min-width: 6.5rem;
  max-width: 18rem;
  padding: 0.4rem 0.6rem 0.45rem;
  border: 1px solid var(--pl-rule);
  border-radius: var(--pl-radius);
  background: var(--pl-paper);
  color: var(--pl-ink);
  box-shadow: 0 1px 2px rgb(0 0 0 / 0.06), 0 6px 16px -6px rgb(0 0 0 / 0.18);
  font-family: var(--pl-font-body);
  font-size: 0.78rem;
  line-height: 1.4;
  pointer-events: none;
}
.pl-tip[hidden] { display: none; }
.pl-tip__title { margin-bottom: 0.05rem; font-weight: 600; }
.pl-tip__row { display: flex; align-items: baseline; justify-content: space-between; gap: 1.25em; }
.pl-tip__label { display: inline-flex; align-items: baseline; gap: 0.45em; min-width: 0; color: var(--pl-muted); }
.pl-tip[data-keyed] .pl-tip__title + .pl-tip__row .pl-tip__label::before {
  content: "";
  flex: none;
  align-self: center;
  width: 0.55em;
  height: 0.55em;
  border-radius: 2px;
  background: var(--pl-tip-color);
}
.pl-tip__value { font-weight: 500; font-variant-numeric: tabular-nums; white-space: nowrap; }

.pl-chart--donut {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 0 2rem;
  align-items: center;
}
.pl-chart--donut > .pl-chart__plot { grid-row: 2; width: min(100%, 13.5rem); }
.pl-chart--donut > .pl-legend {
  grid-row: 3;
  display: grid;
  gap: 0.45rem;
  margin: 1rem 0 0;
}
.pl-chart--donut .pl-legend__item { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 0.6em; }
.pl-chart--donut > .pl-chart__caption { grid-column: 1 / -1; }
@media (min-width: 40rem) {
  .pl-chart--donut { grid-template-columns: 13.5rem minmax(0, 24rem); }
  .pl-chart--donut > .pl-chart__title { grid-column: 1 / -1; }
  .pl-chart--donut > .pl-chart__plot { grid-row: 2; grid-column: 1; }
  .pl-chart--donut > .pl-legend { grid-row: 2; grid-column: 2; margin: 0; }
}
.pl-chart__center {
  position: absolute;
  inset: 0;
  display: grid;
  place-content: center;
  margin: 0;
  text-align: center;
  line-height: 1.15;
  pointer-events: none;
}
.pl-chart__center-value { font-size: 1.45em; font-weight: var(--pl-heading-weight); }
.pl-chart__center-label { color: var(--pl-muted); font-size: 0.8em; }

.pl-sparkline {
  display: inline-block;
  width: 4.5em;
  height: 1.1em;
  color: var(--pl-accent);
  vertical-align: -0.15em;
}
.pl-sparkline__svg { width: 100%; height: 100%; }

/* DataTable */
.pl-table { margin: 1.75em 0; }
.pl-table caption {
  caption-side: bottom;
  padding-top: 0.6em;
  color: var(--pl-muted);
  font-size: 0.86em;
  text-align: left;
}
.pl-table tbody th { font-weight: 600; }
.pl-table th[aria-sort]::after { content: " \2193"; color: var(--pl-muted); font-weight: 400; }
.pl-table th[aria-sort="ascending"]::after { content: " \2191"; }
.pl-table tfoot th,
.pl-table tfoot td { border-top: 2px solid var(--pl-ink); font-weight: var(--pl-heading-weight); }

${badgeStyles}
@media print {
  .pl-chart,
  .pl-table,
  .pl-callout,
  .pl-stat,
  .pl-milestone,
  .pl-todo { break-inside: avoid; }
  .pl-tip { display: none; }
}
@media (forced-colors: active) {
  .pl-swatch,
  .pl-chart__svg,
  .pl-sparkline__svg { forced-color-adjust: none; }
  .pl-callout { border-inline-start-color: CanvasText; }
}
`;
