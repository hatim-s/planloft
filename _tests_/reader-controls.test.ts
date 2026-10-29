import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BarChart } from "../src/components/index.js";
import { CHART_TOOLTIP_SCRIPT, CONTROLS_MARKUP } from "../src/render/controls.js";

test("width controls wait for parsed content and only appear for the supported structure", () => {
  const script = /<script>\n([\s\S]*?)\n<\/script>/.exec(CONTROLS_MARKUP)?.[1];
  assert.ok(script);
  for (const supported of [false, true]) {
    const root: { dataset: Record<string, string> } = { dataset: {} };
    const listeners = new Map<string, () => void>();
    const option = (kind: string, value: string) => ({
      dataset: { [kind]: value },
      pressed: "",
      setAttribute(_name: string, next: string) { this.pressed = next; },
      addEventListener(_name: string, callback: () => void) { listeners.set(`${kind}:${value}`, callback); },
    });
    const themeOptions = ["light", "dark", "system"].map((value) => option("planloftThemeOption", value));
    const layoutOptions = ["reading", "full"].map((value) => option("planloftLayoutOption", value));
    const group = { hidden: true, querySelectorAll: () => layoutOptions };
    let parsed = false;
    let onReady: (() => void) | undefined;
    const document = {
      documentElement: root,
      readyState: "loading",
      querySelector(selector: string) {
        if (selector === ".planloft-plan > article") return parsed && supported ? {} : null;
        return group;
      },
      querySelectorAll: () => themeOptions,
      addEventListener(_name: string, callback: () => void) { onReady = callback; },
    };
    const localStorage = { getItem: () => null, setItem: () => {} };
    runInNewContext(script, { document, localStorage, window: { matchMedia: () => ({ matches: false }) } });
    assert.equal(group.hidden, true);
    assert.equal(themeOptions[2]?.pressed, "true");
    assert.ok(onReady);
    parsed = true;
    onReady();
    assert.equal(group.hidden, !supported);
    if (supported) {
      listeners.get("planloftLayoutOption:full")?.();
      assert.equal(root.dataset.planloftLayout, "full");
      assert.equal(layoutOptions[1]?.pressed, "true");
    } else {
      assert.equal(listeners.has("planloftLayoutOption:full"), false);
      assert.equal(root.dataset.planloftLayout, undefined);
    }
  }
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
