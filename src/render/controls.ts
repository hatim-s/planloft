// Reader controls and the opt-in width contract for rendered documents.

/** Width mode is a root attribute so a theme can respond with plain CSS. */
export const LAYOUT_MODES = ["reading", "full"] as const;
export type LayoutMode = (typeof LAYOUT_MODES)[number];
export const LAYOUT_STORAGE_KEY = "planloft-layout";

const ICON = (paths: string) =>
  `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;

const THEME_OPTIONS = [
  { name: "light", label: "Light theme", icon: ICON('<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"/>') },
  { name: "dark", label: "Dark theme", icon: ICON('<path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a7 7 0 1 0 11 11z"/>') },
  { name: "system", label: "System theme", icon: ICON('<rect x="3" y="4.5" width="18" height="12.5" rx="2"/><path d="M8.5 20.5h7M12 17v3.5"/>') },
] as const;

const LAYOUT_OPTIONS = [
  { name: "reading", label: "Reading width", icon: ICON('<path d="M8 4.5v15M16 4.5v15M3.5 4.5h17M3.5 19.5h17"/><path d="M10.5 9h3M10.5 12h3M10.5 15h3"/>') },
  { name: "full", label: "Full width", icon: ICON('<rect x="3" y="4.5" width="18" height="15" rx="1.5"/><path d="M6.5 9h11M6.5 12h11M6.5 15h11"/>') },
] as const;

const themeButtons = THEME_OPTIONS.map(
  (option) =>
    `  <button class="planloft-theme-option" type="button" data-planloft-theme-option="${option.name}" aria-label="${option.label}" title="${option.label}" aria-pressed="${option.name === "system"}">\n    ${option.icon}\n  </button>`,
).join("\n");

const layoutButtons = LAYOUT_OPTIONS.map(
  (option) =>
    `  <button class="planloft-layout-option" type="button" data-planloft-layout-option="${option.name}" aria-label="${option.label}" title="${option.label}" aria-pressed="${option.name === "reading"}">\n    ${option.icon}\n  </button>`,
).join("\n");

// Chart tooltips. Built-in charts ship a hit layer (src/components/chart-frame.tsx):
// one invisible SVG target per mark whose <title> holds the exact values. Without
// scripting that title is the native tooltip and the accessible name. With it, the
// title moves to aria-label (so hover does not show two tooltips) and one shared
// element follows hover, touch and focus. Content is set with textContent only.
export const CHART_TOOLTIP_SCRIPT = `(() => {
  const HIT = ".pl-chart__hits > *";
  let tip = null;
  let current = null;
  const hitOf = (event) => (event.target instanceof Element ? event.target.closest(HIT) : null);
  const hide = () => {
    if (tip) tip.hidden = true;
    current = null;
  };
  const show = (hit, pointerY) => {
    if (!tip) {
      tip = document.createElement("div");
      tip.className = "pl-tip";
      tip.setAttribute("data-planloft-ignore", "");
      tip.setAttribute("aria-hidden", "true");
      document.body.append(tip);
    }
    const [title, ...rows] = (hit.getAttribute("aria-label") || "").split("\\n");
    tip.replaceChildren();
    const heading = document.createElement("div");
    heading.className = "pl-tip__title";
    heading.textContent = title;
    tip.append(heading);
    for (const row of rows) {
      const split = row.lastIndexOf(": ");
      const line = document.createElement("div");
      line.className = "pl-tip__row";
      const label = document.createElement("span");
      label.className = "pl-tip__label";
      label.textContent = split < 0 ? row : row.slice(0, split);
      const value = document.createElement("span");
      value.className = "pl-tip__value";
      value.textContent = split < 0 ? "" : row.slice(split + 2);
      line.append(label, value);
      tip.append(line);
    }
    const color = hit.dataset.plColor;
    tip.toggleAttribute("data-keyed", Boolean(color) && rows.length === 1);
    if (color) tip.style.setProperty("--pl-tip-color", color);
    tip.hidden = false;
    current = hit;
    // Above the mark, centred, kept inside the viewport; below it when the top is cut off.
    // A column spans the whole plot, so it anchors to the pointer instead of its top.
    const box = hit.getBoundingClientRect();
    const column = hit.classList.contains("pl-hit--column") && pointerY !== undefined;
    const anchorY = column ? pointerY : box.top;
    // Leave room for the value label above a mark.
    const gap = column ? 10 : 24;
    const width = tip.offsetWidth;
    const height = tip.offsetHeight;
    const left = Math.max(8, Math.min(box.left + box.width / 2 - width / 2, window.innerWidth - width - 8));
    let top = anchorY - height - gap;
    if (top < 8) top = (column ? anchorY : box.bottom) + gap;
    tip.style.left = left + "px";
    tip.style.top = top + "px";
  };
  const start = () => {
    const titles = document.querySelectorAll(".pl-chart__hits > * > title");
    if (titles.length === 0) return;
    for (const title of titles) {
      title.parentNode.setAttribute("aria-label", title.textContent);
      title.remove();
    }
    document.addEventListener("pointerover", (event) => {
      const hit = event.pointerType === "touch" ? null : hitOf(event);
      if (hit) show(hit, event.clientY);
    });
    document.addEventListener("pointerout", (event) => {
      if (event.pointerType !== "touch" && hitOf(event) === current) hide();
    });
    document.addEventListener("pointerdown", (event) => {
      if (event.pointerType !== "touch") return;
      const hit = hitOf(event);
      if (hit && hit !== current) show(hit, event.clientY);
      else hide();
    });
    document.addEventListener("focusin", (event) => {
      const hit = hitOf(event);
      if (hit) show(hit);
    });
    document.addEventListener("focusout", (event) => {
      if (hitOf(event) === current) hide();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") hide();
    });
    window.addEventListener("scroll", hide, { passive: true });
    window.addEventListener("resize", hide);
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();`;

// The colour-scheme script keeps its wording: the renderer tests and the gallery
// pin its localStorage handling and the attribute it sets.
export const CONTROLS_MARKUP = `<div class="planloft-controls" data-planloft-ignore>
<div class="planloft-theme-selector planloft-theme-toggle" role="group" aria-label="Color theme">
${themeButtons}
</div>
<div class="planloft-layout-selector" role="group" aria-label="Page width" data-planloft-layout-selector hidden>
${layoutButtons}
</div>
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
(() => {
  const initialize = () => {
    if (!document.querySelector(".planloft-plan > article")) return;
    const root = document.documentElement;
    const group = document.querySelector("[data-planloft-layout-selector]");
    const options = Array.from(group.querySelectorAll("[data-planloft-layout-option]"));
    const key = ${JSON.stringify(LAYOUT_STORAGE_KEY)};
    let saved = null;
    try { saved = localStorage.getItem(key); } catch {}
    let selected = saved === "full" ? "full" : "reading";
    const update = () => {
      if (selected === "reading") delete root.dataset.planloftLayout;
      else root.dataset.planloftLayout = selected;
      for (const option of options) {
        option.setAttribute("aria-pressed", String(option.dataset.planloftLayoutOption === selected));
      }
    };
    for (const option of options) option.addEventListener("click", () => {
      selected = option.dataset.planloftLayoutOption;
      try { localStorage.setItem(key, selected); } catch {}
      update();
    });
    update();
    group.hidden = false;
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initialize, { once: true });
  else initialize();
})();
</script>
<script>
${CHART_TOOLTIP_SCRIPT}
</script>`;

// The controls read four optional custom properties from the theme so they match the
// page instead of the operating system. Themes without them get system colours.
export const CONTROLS_CSS = `
:root { color-scheme: light dark; }
.planloft-controls {
  --planloft-control-ink: var(--planloft-ink, CanvasText);
  --planloft-control-paper: var(--planloft-paper, Canvas);
  --planloft-control-rule: var(--planloft-rule, color-mix(in srgb, CanvasText 18%, transparent));
  --planloft-control-accent: var(--planloft-accent, var(--planloft-control-ink));
  position: fixed;
  z-index: 1000;
  top: 1rem;
  right: 1rem;
  display: flex;
  gap: 0.5rem;
  color: var(--planloft-control-ink);
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  line-height: 0;
}
.planloft-theme-selector,
.planloft-layout-selector {
  display: inline-flex;
  gap: 2px;
  margin: 0;
  padding: 3px;
  border: 1px solid var(--planloft-control-rule);
  border-radius: 999px;
  background: color-mix(in srgb, var(--planloft-control-paper) 86%, transparent);
  -webkit-backdrop-filter: blur(10px);
  backdrop-filter: blur(10px);
}
.planloft-layout-selector[hidden] { display: none; }
.planloft-theme-option,
.planloft-layout-option {
  display: inline-grid;
  width: 1.75rem;
  height: 1.75rem;
  place-items: center;
  margin: 0;
  border: 0;
  border-radius: 999px;
  padding: 0;
  background: transparent;
  color: color-mix(in srgb, var(--planloft-control-ink) 60%, transparent);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: background-color 120ms ease, color 120ms ease;
}
.planloft-theme-option:hover,
.planloft-layout-option:hover {
  color: var(--planloft-control-ink);
  background: color-mix(in srgb, var(--planloft-control-ink) 9%, transparent);
}
.planloft-theme-option[aria-pressed="true"],
.planloft-layout-option[aria-pressed="true"] {
  background: var(--planloft-control-ink);
  color: var(--planloft-control-paper);
}
.planloft-theme-option svg,
.planloft-layout-option svg { width: 0.95rem; height: 0.95rem; pointer-events: none; }
.planloft-theme-option:focus-visible,
.planloft-layout-option:focus-visible {
  outline: 2px solid var(--planloft-control-accent);
  outline-offset: 2px;
}
@media (max-width: 40rem) {
  .planloft-controls { top: 0.625rem; right: 0.625rem; }
}
@media (prefers-reduced-motion: reduce) {
  .planloft-theme-option, .planloft-layout-option { transition: none; }
}
@media print {
  .planloft-controls { display: none; }
}
`;

// Width controls apply only to the explicit .planloft-plan > article structure.
// Reading mode defaults to 44rem; full mode removes the cap.
export const LAYOUT_CSS = `
:root { --planloft-gutter: clamp(1.25rem, 5vw, 3rem); }
.planloft-plan:has(> article) {
  container: planloft-plan / inline-size;
  box-sizing: border-box;
  max-width: calc(var(--planloft-measure, 44rem) + 2 * var(--planloft-bleed, 0rem) + 2 * var(--planloft-gutter));
  margin-inline: auto;
  padding-inline: var(--planloft-gutter);
}
.planloft-plan:has(> article) > article {
  --planloft-wide: min(var(--planloft-bleed, 0rem), max(0px, (100cqw - var(--planloft-measure, 44rem)) / 2));
  max-width: var(--planloft-measure, 44rem);
  margin-inline: auto;
}
.planloft-plan:has(> article) > .planloft-comments {
  max-width: var(--planloft-measure, 44rem);
  margin-inline: auto;
}
.planloft-plan:has(> article) :is(article, section) > :is(pre, figure, .pl-stats) {
  margin-inline: calc(-1 * var(--planloft-wide, 0px));
  max-width: calc(100% + 2 * var(--planloft-wide, 0px));
}
:root[data-planloft-layout="full"] .planloft-plan:has(> article) {
  max-width: none;
  padding-inline: clamp(1.25rem, 6vw, 5rem);
}
:root[data-planloft-layout="full"] .planloft-plan:has(> article) > article {
  --planloft-wide: 0px;
  max-width: none;
}
:root[data-planloft-layout="full"] .planloft-plan:has(> article) > .planloft-comments { max-width: none; }
@media print {
  :root[data-planloft-layout="full"] .planloft-plan:has(> article),
  .planloft-plan:has(> article) { max-width: none; padding-inline: 0; }
  :root[data-planloft-layout="full"] .planloft-plan:has(> article) > article,
  .planloft-plan:has(> article) > article { --planloft-wide: 0px; max-width: none; }
  :root[data-planloft-layout="full"] .planloft-plan:has(> article) > .planloft-comments,
  .planloft-plan:has(> article) > .planloft-comments { max-width: none; }
}
`;
