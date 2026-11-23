import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BarChart } from "../src/components/index.js";
import { CHART_TOOLTIP_SCRIPT, CONTROLS_MARKUP } from "../src/render/controls.js";

function openReader(pathname: string, storage: Pick<Storage, "getItem" | "setItem" | "removeItem">) {
  const script = /<script>\n([\s\S]*?)\n<\/script>/.exec(CONTROLS_MARKUP)?.[1];
  assert.ok(script);
  const root = { dataset: {} as Record<string, string> };
  const group = { hidden: true };
  const settings = { hidden: true, addEventListener() {} };
  const listeners = new Map<string, () => void>();
  const onStorage: ((event: { key: string | null; storageArea: typeof storage }) => void)[] = [];
  const defaults = {
    theme: { value: "", options: ["light", "dark", "system"].map((value) => ({ value })) },
    layout: { value: "", options: ["reading", "full"].map((value) => ({ value })) },
  };
  const resets = { theme: { disabled: false }, layout: { disabled: false } };
  const targets = new Map<string, object>();
  const choices = new Map<string, { pressed: string }[]>();
  for (const name of ["theme", "layout"] as const) {
    const attr = "data-planloft-" + name + "-option";
    choices.set("[" + attr + "]", defaults[name].options.map(({ value }) => ({
      pressed: "",
      getAttribute: () => value,
      setAttribute(_key: string, next: string) { this.pressed = next; },
      addEventListener(_event: string, callback: () => void) { listeners.set(name + ":" + value, callback); },
    })));
    targets.set('[data-planloft-default="' + name + '"]', Object.assign(defaults[name], {
      addEventListener: (_event: string, callback: () => void) => listeners.set("default:" + name, callback),
      focus() {},
    }));
    targets.set('[data-planloft-reset="' + name + '"]', Object.assign(resets[name], {
      addEventListener: (_event: string, callback: () => void) => listeners.set("reset:" + name, callback),
      dispatchEvent() {},
    }));
  }
  targets.set('[data-planloft-theme-option="system"]', {});
  targets.set("[data-planloft-layout-selector]", group);
  targets.set(".planloft-appearance", settings);
  const document = {
    documentElement: root,
    readyState: "loading",
    querySelector: (selector: string) => targets.get(selector),
    querySelectorAll: (selector: string) => choices.get(selector),
    addEventListener: (event: string, callback: () => void) => listeners.set(event, callback),
  };
  runInNewContext(script, {
    document, localStorage: storage, location: { pathname }, CustomEvent,
    window: {
      matchMedia: () => ({ matches: false }),
      addEventListener: (_name: string, callback: (typeof onStorage)[number]) => { onStorage.push(callback); },
    },
  });
  assert.equal(group.hidden, true);
  listeners.get("DOMContentLoaded")!();
  assert.equal(group.hidden, false);
  assert.equal(settings.hidden, false);
  return {
    root, defaults, resets, choices,
    click: (id: string) => listeners.get(id)!(),
    storageChanged(key: string | null) {
      for (const callback of onStorage) callback({ key, storageArea: storage });
    },
  };
}

test("reader overrides are independent per page and setting and can return to stored defaults", () => {
  const values = new Map([["planloft-color-scheme", "dark"], ["planloft-layout", "full"]]);
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
  const first = openReader("/first/", storage);
  assert.deepEqual(first.root.dataset, { planloftColorScheme: "dark", planloftLayout: "full" });
  assert.equal(first.resets.theme.disabled, true);

  first.click("theme:system");
  first.click("layout:reading");
  assert.deepEqual(first.root.dataset, {});
  assert.equal(first.choices.get("[data-planloft-theme-option]")?.[2]?.pressed, "true");
  assert.equal(first.resets.theme.disabled, false);

  const second = openReader("/second/", storage);
  assert.deepEqual(second.root.dataset, { planloftColorScheme: "dark", planloftLayout: "full" });
  second.defaults.theme.value = "light";
  second.click("default:theme");
  assert.equal(second.root.dataset.planloftColorScheme, "light");
  first.storageChanged("planloft-color-scheme");
  assert.deepEqual(first.root.dataset, {});
  assert.equal(first.defaults.theme.value, "light");

  const reopened = openReader("/first/index.html", storage);
  assert.deepEqual(reopened.root.dataset, {});
  assert.equal(reopened.defaults.theme.value, "light");
  reopened.click("reset:theme");
  assert.deepEqual(reopened.root.dataset, { planloftColorScheme: "light" });
  assert.equal(reopened.resets.theme.disabled, true);
  assert.equal(openReader("/first/", storage).root.dataset.planloftColorScheme, "light");

  values.set("planloft-color-scheme:doc:/third/", "invalid");
  values.set("planloft-layout", "invalid");
  assert.deepEqual(openReader("/third/", storage).root.dataset, { planloftColorScheme: "light" });
});

test("reader controls still work when the browser denies storage", () => {
  const denied = () => { throw new Error("Storage denied"); };
  const reader = openReader("/first/", { getItem: denied, setItem: denied, removeItem: denied });
  assert.deepEqual(reader.root.dataset, {});
  reader.click("theme:dark");
  reader.click("layout:full");
  assert.deepEqual(reader.root.dataset, { planloftColorScheme: "dark", planloftLayout: "full" });
  reader.click("reset:layout");
  assert.deepEqual(reader.root.dataset, { planloftColorScheme: "dark" });
});

test("the chart tooltip script lifts hit titles into accessible names and stays idle without charts", () => {
  assert.ok(CONTROLS_MARKUP.includes(`<script>\n${CHART_TOOLTIP_SCRIPT}\n</script>`));
  for (const charts of [false, true]) {
    const hit = { label: "", setAttribute(_name: string, value: string) { this.label = value; } };
    const title = { textContent: "Q1\nWeb: 12", parentNode: hit, removed: false, remove() { this.removed = true; } };
    const listeners: string[] = [];
    let onReady: (() => void) | undefined;
    const document = {
      readyState: "loading",
      querySelectorAll: () => (charts ? [title] : []),
      addEventListener(name: string, callback: () => void) { if (name === "DOMContentLoaded") onReady = callback; else listeners.push(name); },
    };
    const window = { addEventListener(name: string) { listeners.push(name); } };
    runInNewContext(CHART_TOOLTIP_SCRIPT, { document, window });
    assert.ok(onReady);
    onReady();
    assert.equal(hit.label, charts ? "Q1\nWeb: 12" : "");
    assert.equal(title.removed, charts);
    assert.deepEqual(listeners, charts ? ["pointerover", "pointerout", "pointerdown", "focusin", "focusout", "keydown", "scroll", "resize"] : []);
  }
});

test("each chart frame is one tab stop and the tooltip script moves focus between its hits", () => {
  const markup = renderToStaticMarkup(createElement(BarChart, { data: [{ q: "Q1", a: 1, b: 2 }, { q: "Q2", a: 3, b: 4 }], x: "q", y: ["a", "b"] }));
  const frames = markup.split('class="pl-chart__frame"').slice(1);
  assert.equal(frames.length, 3);
  for (const frame of frames) {
    assert.deepEqual(Array.from(frame.matchAll(/role="listitem" tabindex="(-?\d)"/g), (match) => match[1]), ["0", "-1", "-1", "-1"]);
  }

  // Four hits in one drawing, a body for the tooltip and the listeners the script registers.
  const listeners = new Map<string, (event: object) => void>();
  let active: unknown = null;
  class Hit {
    tabindex: string;
    label = "";
    focused = 0;
    readonly classList = { contains: () => false };
    readonly dataset = {};
    parentNode = { children: [] as Hit[] };
    constructor(index: number) { this.tabindex = index === 0 ? "0" : "-1"; this.label = `Q${index}\nA: ${index}`; }
    closest() { return this; }
    getAttribute() { return this.label; }
    setAttribute(name: string, value: string) { if (name === "tabindex") this.tabindex = value; }
    focus() { this.focused++; active = this; }
    getBoundingClientRect() { return { left: 0, top: 100 + this.focused, width: 10, height: 10, bottom: 110 }; }
  }
  const hits = [0, 1, 2, 3].map((index) => new Hit(index));
  for (const hit of hits) hit.parentNode.children = hits;
  const node = () => ({ style: { setProperty() {} } as Record<string, unknown>, setAttribute() {}, append() {}, replaceChildren() {}, toggleAttribute() {}, offsetWidth: 80, offsetHeight: 40, hidden: true, textContent: "", className: "" });
  let tip: ReturnType<typeof node> | undefined;
  const document = {
    readyState: "complete",
    get activeElement() { return active; },
    querySelectorAll: () => [{ textContent: "x", parentNode: { setAttribute() {} }, remove() {} }],
    createElement: () => { const element = node(); tip ??= element; return element; },
    body: { append() {} },
    addEventListener(name: string, callback: (event: object) => void) { listeners.set(name, callback); },
  };
  const window = { innerWidth: 1000, addEventListener(name: string, callback: (event: object) => void) { listeners.set(name, callback); } };
  runInNewContext(CHART_TOOLTIP_SCRIPT, { document, window, Element: Hit });
  const key = (target: Hit, name: string) => {
    let prevented = false;
    listeners.get("keydown")!({ key: name, target, preventDefault: () => { prevented = true; } });
    return prevented;
  };
  assert.equal(key(hits[0]!, "ArrowRight"), true);
  assert.deepEqual(hits.map((hit) => hit.tabindex), ["-1", "0", "-1", "-1"]);
  assert.equal(active, hits[1]);
  key(hits[1]!, "End");
  assert.equal(active, hits[3]);
  key(hits[3]!, "ArrowDown");
  assert.equal(active, hits[3]);
  key(hits[3]!, "Home");
  key(hits[0]!, "ArrowLeft");
  assert.deepEqual(hits.map((hit) => hit.tabindex), ["0", "-1", "-1", "-1"]);
  assert.equal(key(hits[0]!, "Tab"), false);

  // Focus shows the tooltip; the scroll that brings the hit into view moves it instead of hiding it.
  listeners.get("focusin")!({ target: hits[0] });
  assert.equal(tip?.hidden, false);
  const top = tip?.style.top;
  hits[0]!.focused++;
  listeners.get("scroll")!({});
  assert.equal(tip?.hidden, false);
  assert.notEqual(tip?.style.top, top);
  active = null;
  listeners.get("scroll")!({});
  assert.equal(tip?.hidden, true);
});
