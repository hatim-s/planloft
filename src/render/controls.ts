// Reader controls and the shared width contract for rendered documents.

/** Width mode is a root attribute so a theme can respond with plain CSS. */
export const LAYOUT_MODES = ["reading", "full"] as const;
export type LayoutMode = (typeof LAYOUT_MODES)[number];

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
// Each drawing is one tab stop; arrow keys, Home and End move focus between its hits
// and the tabindex="0" with it, so Tab returns to the last hit visited.
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
    place(hit, pointerY);
  };
  const place = (hit, pointerY) => {
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
    const STEPS = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") return hide();
      const hit = hitOf(event);
      const step = STEPS[event.key];
      if (!hit || event.altKey || event.ctrlKey || event.metaKey || (!step && event.key !== "Home" && event.key !== "End")) return;
      event.preventDefault();
      const hits = Array.from(hit.parentNode.children);
      const next = event.key === "Home" ? hits[0] : event.key === "End" ? hits[hits.length - 1] : hits[hits.indexOf(hit) + step];
      if (!next || next === hit) return;
      hit.setAttribute("tabindex", "-1");
      next.setAttribute("tabindex", "0");
      next.focus();
    });
    // Focusing a hit can scroll it into view, so a focused hit keeps its tooltip and
    // the tooltip moves with it. Hover tooltips close on scroll.
    window.addEventListener("scroll", () => {
      if (current && current === document.activeElement) place(current);
      else hide();
    }, { passive: true });
    window.addEventListener("resize", hide);
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();`;

const defaultOptions = (options: readonly { name: string; label: string }[], selected: string) =>
  options.map(({ name, label }) => `<option value="${name}"${name === selected ? " selected" : ""}>${label}</option>`).join("");

export const CONTROLS_MARKUP = `<div class="planloft-controls" data-planloft-ignore>
<div class="planloft-theme-selector planloft-theme-toggle" role="group" aria-label="Color theme">
${themeButtons}
</div>
<div class="planloft-layout-selector" role="group" aria-label="Page width" data-planloft-layout-selector hidden>
${layoutButtons}
</div>
<details class="planloft-appearance" hidden>
<summary aria-label="Appearance settings" title="Appearance settings">${ICON('<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1m9.2 9.2 2.1 2.1m-13.4 0 2.1-2.1m9.2-9.2 2.1-2.1"/>')}</summary>
<div class="planloft-appearance-panel">
<button type="button" data-planloft-reset="theme">Use default color theme here</button>
<button type="button" data-planloft-reset="layout">Use default width here</button>
<label>Default color theme <select data-planloft-default="theme">${defaultOptions(THEME_OPTIONS, "system")}</select></label>
<label>Default page width <select data-planloft-default="layout">${defaultOptions(LAYOUT_OPTIONS, "reading")}</select></label>
</div>
</details>
</div>
<script>
(() => {
  const root = document.documentElement;
  const docPath = location.pathname.replace(/\\/index\\.html$/, "/");
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const read = (key, options) => {
    try {
      const value = localStorage.getItem(key);
      if (options.some(option => option.value === value)) return value;
    } catch {}
    return null;
  };
  const store = (key, value) => {
    try {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch {}
  };
  const bind = (name, key, attribute, builtIn) => {
    const docKey = key + ":doc:" + docPath;
    const buttons = document.querySelectorAll("[data-planloft-" + name + "-option]");
    const defaults = document.querySelector('[data-planloft-default="' + name + '"]');
    const reset = document.querySelector('[data-planloft-reset="' + name + '"]');
    const options = Array.from(defaults.options);
    let preferred = read(key, options) ?? builtIn;
    let override = read(docKey, options);
    const update = () => {
      const selected = override ?? preferred;
      if (selected === builtIn) delete root.dataset[attribute];
      else root.dataset[attribute] = selected;
      for (const button of buttons) {
        const value = button.getAttribute("data-planloft-" + name + "-option");
        button.setAttribute("aria-pressed", String(value === selected));
      }
      defaults.value = preferred;
      reset.disabled = override === null;
      reset.dispatchEvent(new CustomEvent("planloft-appearance-change", { bubbles: true, detail: name }));
    };
    for (const button of buttons) button.addEventListener("click", () => {
      override = button.getAttribute("data-planloft-" + name + "-option");
      store(docKey, override);
      update();
    });
    defaults.addEventListener("change", () => {
      preferred = defaults.value;
      store(key, preferred);
      update();
    });
    reset.addEventListener("click", () => {
      override = null;
      store(docKey, null);
      update();
      defaults.focus();
    });
    window.addEventListener("storage", (event) => {
      if (event.storageArea !== localStorage) return;
      if (event.key === key || event.key === null) preferred = read(key, options) ?? builtIn;
      else if (event.key !== docKey) return;
      if (event.key === docKey || event.key === null) override = read(docKey, options);
      update();
    });
    update();
  };
  bind("theme", "planloft-color-scheme", "planloftColorScheme", "system");
  const system = document.querySelector('[data-planloft-theme-option="system"]');
  const describeSystem = () => { system.title = "System theme (currently " + (media.matches ? "dark" : "light") + ")"; };
  media.addEventListener?.("change", describeSystem);
  describeSystem();
  const initializeLayout = () => {
    bind("layout", "planloft-layout", "planloftLayout", "reading");
    document.querySelector("[data-planloft-layout-selector]").hidden = false;
    document.querySelector(".planloft-appearance").hidden = false;
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initializeLayout, { once: true });
  else initializeLayout();
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
.planloft-layout-selector,
.planloft-appearance > summary {
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
.planloft-layout-option,
.planloft-appearance > summary {
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
.planloft-layout-option:hover,
.planloft-appearance > summary:hover {
  color: var(--planloft-control-ink);
  background: color-mix(in srgb, var(--planloft-control-ink) 9%, transparent);
}
.planloft-theme-option[aria-pressed="true"],
.planloft-layout-option[aria-pressed="true"] {
  background: var(--planloft-control-ink);
  color: var(--planloft-control-paper);
}
.planloft-theme-option svg,
.planloft-layout-option svg,
.planloft-appearance > summary svg { width: 0.95rem; height: 0.95rem; pointer-events: none; }
.planloft-theme-option:focus-visible,
.planloft-layout-option:focus-visible,
.planloft-appearance :focus-visible {
  outline: 2px solid var(--planloft-control-accent);
  outline-offset: 2px;
}
.planloft-appearance { position: relative; }
.planloft-appearance > summary {
  box-sizing: content-box;
  padding: 3px;
  background: var(--planloft-control-paper);
}
.planloft-appearance > summary::-webkit-details-marker { display: none; }
.planloft-appearance > summary:hover {
  background: var(--planloft-control-paper);
}
.planloft-appearance-panel {
  position: absolute;
  top: calc(100% + 0.5rem);
  right: 0;
  display: grid;
  gap: 0.5rem;
  width: max-content;
  max-width: calc(100vw - 2rem);
  box-sizing: border-box;
  padding: 0.75rem;
  border: 1px solid var(--planloft-control-rule);
  border-radius: 0.75rem;
  background: var(--planloft-control-paper);
  font: 0.875rem/1.4 system-ui, sans-serif;
}
.planloft-appearance-panel label {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.75rem;
}
.planloft-appearance-panel :is(button, select) {
  padding: 0.25rem 0.5rem;
  border: 1px solid var(--planloft-control-rule);
  border-radius: 0.35rem;
  color: inherit;
  background: var(--planloft-control-paper);
  font: inherit;
}
.planloft-appearance-panel button:disabled { opacity: 0.5; }
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

// Authored HTML uses the body when it does not have the shared article shell.
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
html > body:not(:has(.planloft-plan > article)) {
  box-sizing: border-box;
  max-width: calc(var(--planloft-measure, 44rem) + 2 * var(--planloft-gutter));
  margin-inline: auto;
  padding-inline: var(--planloft-gutter);
}
:root[data-planloft-layout="full"] > body:not(:has(.planloft-plan > article)) {
  max-width: none;
  padding-inline: clamp(1.25rem, 6vw, 5rem);
}
:root[data-planloft-layout="full"] > body:not(:has(.planloft-plan > article)) > :is(main, article) {
  max-width: none;
}
@media print {
  html > body:not(:has(.planloft-plan > article)),
  :root[data-planloft-layout="full"] > body:not(:has(.planloft-plan > article)) { max-width: none; padding-inline: 0; }
  :root[data-planloft-layout="full"] .planloft-plan:has(> article),
  .planloft-plan:has(> article) { max-width: none; padding-inline: 0; }
  :root[data-planloft-layout="full"] .planloft-plan:has(> article) > article,
  .planloft-plan:has(> article) > article { --planloft-wide: 0px; max-width: none; }
  :root[data-planloft-layout="full"] .planloft-plan:has(> article) > .planloft-comments,
  .planloft-plan:has(> article) > .planloft-comments { max-width: none; }
}
`;
