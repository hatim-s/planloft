import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";
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
