import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BarChart, ComponentInputError, DataTable, DonutChart, Heatmap, LineChart, Sparkline, Todo, WaterfallChart } from "../src/components/index.js";
import { exactNumberFormatter, type Row } from "../src/components/data.js";
import { buildGallery } from "../src/gallery/index.js";

const rows = [
  { month: "Jan", web: 12, ios: 8 },
  { month: "Feb", web: 15, ios: 9 },
  { month: "Mar", web: 14, ios: 12 },
];

test("Todo renders the checkbox contract the collaboration runtime binds to", () => {
  const html = renderToStaticMarkup(createElement(Todo, { task: "ship-beta" }, "Ship the beta"));
  assert.match(html, /<input type="checkbox"[^>]*data-planloft-task="ship-beta"[^>]*disabled=""/);
  const id = html.match(/id="([^"]+)"/)?.[1];
  assert.ok(id);
  assert.ok(html.includes(`<label for="${id}"`));
  assert.throws(() => renderToStaticMarkup(createElement(Todo, { task: "has space" }, "x")), ComponentInputError);
});

test("charts are static TanStack SVG with one drawing per frame and a hidden exact-value table", () => {
  const html = renderToStaticMarkup(createElement(BarChart, { data: rows, x: "month", y: ["web", "ios"], layout: "stacked" }));
  const frames = [...html.matchAll(/data-frame="(\w+)"><svg class="ts-chart pl-chart__svg"/g)].map((match) => match[1]);
  assert.deepEqual(frames, ["compact", "regular", "wide"]);
  assert.doesNotMatch(html, /<script/);
  assert.doesNotMatch(html, /ts-chart__focus-layer/);
  assert.doesNotMatch(html, /<details/);
  // The table is for screen readers and never for anchors: hidden, and skipped by the text index.
  assert.match(html, /<div class="pl-sr pl-chart__data" data-planloft-ignore=""><table>/);
  assert.match(html, /<th scope="row">Feb<\/th><td>15<\/td><td>9<\/td><td>24<\/td>/);
});

// One frame's hit targets, in the frame's own viewBox units.
function hitsOf(frame: string) {
  return [...frame.matchAll(/<(rect|path) (class="pl-hit[^"]*" [^>]*)><title>([^<]*)<\/title>/g)].map((match) => {
    const attributes = Object.fromEntries([...match[2]!.matchAll(/([\w-]+)="([^"]*)"/g)].map((pair) => [pair[1], pair[2]]));
    const number = (name: string) => Number(attributes[name]);
    return { shape: match[1], x: number("x"), y: number("y"), width: number("width"), height: number("height"), lines: match[3]!.split("\n"), attributes };
  });
}

function framesOf(html: string) {
  return html.split(/<div class="pl-chart__frame" data-frame="\w+">/).slice(1);
}

test("stacked bar hits keep the painted geometry in every frame and never invent values", () => {
  const data = [{ q: "Q1", a: 10, b: -4 }, { q: "Q2", a: null, b: 6 }, { q: "Q3", a: 1.2345, b: 12345 }];
  const html = renderToStaticMarkup(createElement(BarChart, { data, x: "q", y: ["a", "b"], layout: "stacked", format: "compact" }));
  const frames = framesOf(html);
  assert.equal(frames.length, 3);
  for (const frame of frames) {
    const hits = hitsOf(frame);
    // Five painted segments: the missing Q2 "a" has no bar and so no target.
    assert.deepEqual(hits.map((hit) => hit.lines[0]), ["Q1", "Q1", "Q2", "Q3", "Q3"]);
    const zero = Number(/data-ts-key="y-grid:number:0" x1="[^"]*" y1="([^"]*)"/.exec(frame)?.[1]);
    const tickX = (category: string) => Number(new RegExp(`data-ts-key="x-tick-label:string:2:${category}"[^>]* x="([^"]*)"`).exec(frame)?.[1]);
    const [positive, negative, , , large] = hits;
    assert.ok(positive && negative && large);
    // Positive bars end at the zero line; the negative bar starts there and hangs below.
    assert.ok(Math.abs(positive.y + positive.height - zero) <= 2, `${positive.y + positive.height} vs zero ${zero}`);
    assert.ok(Math.abs(negative.y - zero) <= 2);
    assert.ok(negative.y + negative.height > zero);
    for (const hit of hits) assert.ok(Math.abs(hit.x + hit.width / 2 - tickX(hit.lines[0]!)) < 0.1, `${hit.lines[0]} centred on its tick`);
    // Slivers next to a large value still get a target a pointer can reach.
    assert.ok(positive.height >= 4);
    assert.deepEqual(negative.lines, ["Q1", "A: 10", "B: −4", "Total: 6"]);
    assert.deepEqual(hits[2]!.lines, ["Q2", "A: —", "B: 6", "Total: —"]);
    assert.deepEqual(large.lines, ["Q3", "A: 1.2345", "B: 12,345", "Total: 12,346.2345"]);
    assert.equal(negative.attributes["data-pl-color"], "var(--pl-series-2)");
    assert.match(frame, /^<svg[^>]* role="group"/);
  }
});

test("line columns tile the plot around each tick in every frame", () => {
  const data = [{ q: "Q1", a: 10, b: -4 }, { q: "Q2", a: null, b: 6 }, { q: "Q3", a: 1.2345, b: 12345 }];
  const html = renderToStaticMarkup(createElement(LineChart, { data, x: "q", y: ["a", "b"], format: "compact" }));
  for (const frame of framesOf(html)) {
    const hits = hitsOf(frame);
    assert.equal(hits.length, 3);
    const [plotLeft, plotRight] = /data-ts-key="y-grid:number:0" x1="([^"]*)" y1="[^"]*" x2="([^"]*)"/.exec(frame)!.slice(1).map(Number);
    assert.ok(Math.abs(hits[0]!.x - plotLeft!) < 0.1);
    assert.ok(Math.abs(hits[2]!.x + hits[2]!.width - plotRight!) < 0.1);
    for (const [index, hit] of hits.entries()) {
      const next = hits[index + 1];
      if (next) assert.ok(Math.abs(hit.x + hit.width - next.x) < 0.1, "columns touch");
      const tickX = Number(new RegExp(`data-ts-key="x-tick-label:string:2:${hit.lines[0]}"[^>]* x="([^"]*)"`).exec(frame)?.[1]);
      assert.ok(tickX > hit.x && tickX < hit.x + hit.width, "tick inside its column");
      assert.ok(hit.attributes.class?.includes("pl-hit--column"));
    }
    assert.deepEqual(hits[1]!.lines, ["Q2", "A: —", "B: 6"]);
    assert.deepEqual(hits[2]!.lines, ["Q3", "A: 1.2345", "B: 12,345"]);
  }
});

test("donut, waterfall and heatmap hits name their mark, and sparkline hits stay hover-only", () => {
  const donut = renderToStaticMarkup(createElement(DonutChart, { data: [{ n: "x", v: 3 }, { n: "y", v: 1 }], label: "n", value: "v" }));
  assert.deepEqual(hitsOf(donut).map((hit) => [hit.shape, ...hit.lines]), [["path", "x", "V: 3", "Share: 75%"], ["path", "y", "V: 1", "Share: 25%"]]);
  const waterfall = renderToStaticMarkup(createElement(WaterfallChart, { data: [{ s: "Open", v: 100 }, { s: "Churn", v: -12.5 }], label: "s", value: "v" }));
  assert.deepEqual(hitsOf(framesOf(waterfall)[0]!).map((hit) => hit.lines), [["Open", "Balance: 100"], ["Churn", "Change: −12.5", "Running total: 87.5"], ["Total", "Balance: 87.5"]]);
  const heatmap = renderToStaticMarkup(createElement(Heatmap, { data: [{ d: "Mon", h: "9", v: 2 }, { d: "Mon", h: "10", v: null }], x: "h", y: "d", value: "v" }));
  assert.deepEqual(hitsOf(framesOf(heatmap)[0]!).map((hit) => hit.lines), [["Mon, 9", "V: 2"], ["Mon, 10", "V: —"]]);
  const sparkline = renderToStaticMarkup(createElement(Sparkline, { values: [1, 2.5, 3], label: "Latency", unit: "ms" }));
  assert.match(sparkline, /<g class="pl-chart__hits" aria-hidden="true" data-planloft-ignore>/);
  assert.doesNotMatch(sparkline, /tabindex="0"/);
  assert.deepEqual(hitsOf(sparkline)[1]!.lines, ["Point 2 of 3", "Latency: 2.5 ms"]);
});

test("a chart that names a missing column fails the render with the component and key", () => {
  assert.throws(
    () => renderToStaticMarkup(createElement(LineChart, { data: rows, x: "month", y: "android" })),
    /<LineChart> references the column "android"/,
  );
});

test("repeated task keys have distinct matching IDs and deterministic markup", () => {
  const render = () => renderToStaticMarkup(createElement("div", null,
    createElement(Todo, { task: "same", label: "First" }),
    createElement(Todo, { task: "same", label: "Second" }),
  ));
  const html = render();
  const ids = [...html.matchAll(/<input[^>]* id="([^"]+)"/g)].map((match) => match[1]);
  const targets = [...html.matchAll(/<label for="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, 2);
  assert.deepEqual(targets, ids);
  assert.equal((html.match(/data-planloft-task="same"/g) ?? []).length, 2);
  assert.equal(render(), html);
});

test("donut and waterfall reject unknown or invalid contributions", () => {
  for (const n of [-5, null]) {
    assert.throws(() => renderToStaticMarkup(createElement(DonutChart, {
      data: [{ name: "bad", n }], label: "name", value: "n",
    })), /<DonutChart> needs a non-negative numeric value for "n" in row 1/);
  }
  assert.throws(() => renderToStaticMarkup(createElement(WaterfallChart, {
    data: [{ name: "start", n: 10 }, { name: "missing", n: null }], label: "name", value: "n",
  })), /<WaterfallChart> needs a numeric value for "n" in row 2/);
});

test("chart data tables preserve values independently of compact chart labels", () => {
  const data = [{ name: "A", n: 1.2345 }, { name: "B", n: 12345 }];
  const charts = [
    createElement(LineChart, { data, x: "name", y: "n", format: "compact" }),
    createElement(BarChart, { data, x: "name", y: "n", format: "compact" }),
    createElement(DonutChart, { data, label: "name", value: "n", format: "compact" }),
    createElement(WaterfallChart, { data, label: "name", value: "n", format: "compact" }),
    createElement(Heatmap, { data: data.map((row) => ({ ...row, group: "G" })), x: "name", y: "group", value: "n", format: "compact" }),
  ];
  for (const chart of charts) {
    const html = renderToStaticMarkup(chart);
    const table = html.slice(html.indexOf('<div class="pl-sr'));
    assert.match(table, />1\.2345</);
    assert.match(table, />\+?12345</);
  }
});

test("numeric table sorting puts all missing cells last in either direction", () => {
  const data: Row[] = [{ name: "a", n: 10 }, { name: "b", n: null }, { name: "c", n: 2 }, { name: "d" }];
  for (const [sort, expected] of [["n", ["c", "a", "b", "d"]], ["-n", ["a", "c", "b", "d"]]] as const) {
    const html = renderToStaticMarkup(createElement(DataTable, { data, columns: ["name", { key: "n", format: "number" }], sort }));
    const body = html.match(/<tbody>(.*?)<\/tbody>/)?.[1] ?? "";
    assert.deepEqual([...body.matchAll(/<th scope="row">([^<]+)<\/th>/g)].map((match) => match[1]), expected);
  }
});

test("badge table columns colour by value and keep text sorting", () => {
  const data: Row[] = [{ team: "Search", tier: "Beta" }, { team: "API", tier: "GA" }, { team: "Web", tier: null }, { team: "Mobile", tier: "Alpha" }];
  const html = renderToStaticMarkup(createElement(DataTable, {
    data,
    columns: ["team", { key: "tier", format: "badge", colors: { GA: "green", Beta: "blue" } }],
    sort: "tier",
  }));
  const cells = [...html.matchAll(/<tr><th scope="row">(\w+)<\/th><td>(.*?)<\/td><\/tr>/g)].map((match) => [match[1], match[2]]);
  // An empty cell is empty text, so it sorts first, as in status and text columns.
  assert.deepEqual(cells, [
    ["Web", ""],
    ["Mobile", '<span class="pl-badge" data-color="gray">Alpha</span>'],
    ["Search", '<span class="pl-badge" data-color="blue">Beta</span>'],
    ["API", '<span class="pl-badge" data-color="green">GA</span>'],
  ]);
  assert.throws(
    () => renderToStaticMarkup(createElement(DataTable, { data, columns: [{ key: "tier", format: "badge", colors: { GA: "lime" as "green" } }] })),
    ComponentInputError,
  );
  const inheritedNames = renderToStaticMarkup(createElement(DataTable, {
    data: [{ tag: "constructor" }, { tag: "__proto__" }],
    columns: [{ key: "tag", format: "badge" }],
  }));
  assert.match(inheritedNames, /data-color="gray">constructor<\/span>/);
  assert.match(inheritedNames, /data-color="gray">__proto__<\/span>/);
});

test("heatmap rejects a dataset with no numeric values", () => {
  assert.throws(() => renderToStaticMarkup(createElement(Heatmap, {
    data: [{ x: "a", y: "b", n: null }], x: "x", y: "y", value: "n",
  })), /<Heatmap> needs at least one numeric value for "n"/);
});

test("whitespace is missing across numeric chart and table consumers", () => {
  const blank = "  \t ";
  const data = [{ name: "blank", n: blank }, { name: "zero", n: 0 }, { name: "negative", n: -2 }];
  assert.throws(() => renderToStaticMarkup(createElement(DonutChart, { data, label: "name", value: "n" })), /<DonutChart> needs a non-negative numeric value for "n" in row 1/);
  assert.throws(() => renderToStaticMarkup(createElement(WaterfallChart, { data, label: "name", value: "n" })), /<WaterfallChart> needs a numeric value for "n" in row 1/);
  assert.throws(() => renderToStaticMarkup(createElement(Heatmap, { data: [{ x: "a", y: "b", n: blank }], x: "x", y: "y", value: "n" })), /<Heatmap> needs at least one numeric value for "n"/);
  const line = renderToStaticMarkup(createElement(LineChart, { data, x: "name", y: "n" }));
  assert.match(line, /<th scope="row">blank<\/th><td>—<\/td>/);
  assert.match(line, /<th scope="row">zero<\/th><td>0<\/td>/);
  assert.match(line, /<th scope="row">negative<\/th><td>-2<\/td>/);
  const table = renderToStaticMarkup(createElement(DataTable, { data, columns: ["name", "n"], sort: "n", totals: true }));
  const body = table.match(/<tbody>(.*?)<\/tbody>/)?.[1] ?? "";
  assert.deepEqual([...body.matchAll(/<th scope="row">([^<]+)<\/th>/g)].map((match) => match[1]), ["negative", "zero", "blank"]);
  assert.match(table, /<tfoot><tr><th scope="row">Total<\/th><td class="pl-num">—<\/td>/);
});

test("bar totals and ordering leave incomplete aggregates unknown", () => {
  const data = [
    { name: "partial", n: 10, m: null },
    { name: "negative", n: -3, m: 1 },
    { name: "zero", n: 0, m: 0 },
    { name: "positive", n: 5, m: 2 },
    { name: "blank", n: " ", m: 3 },
  ];
  for (const layout of ["stacked", "grouped"] as const) {
    for (const [sort, expected] of [["ascending", ["negative", "zero", "positive", "partial", "blank"]], ["descending", ["positive", "zero", "negative", "partial", "blank"]]] as const) {
      const html = renderToStaticMarkup(createElement(BarChart, { data, x: "name", y: ["n", "m"], layout, sort }));
      const table = html.slice(html.indexOf('<div class="pl-sr'));
      assert.deepEqual([...table.matchAll(/<th scope="row">([^<]+)<\/th>/g)].map((match) => match[1]), expected);
      if (layout === "stacked") {
        assert.match(table, /<th scope="row">partial<\/th><td>10<\/td><td>—<\/td><td>—<\/td>/);
        assert.match(table, /<th scope="row">zero<\/th><td>0<\/td><td>0<\/td><td>0<\/td>/);
        assert.match(table, /<th scope="row">negative<\/th><td>-3<\/td><td>1<\/td><td>-2<\/td>/);
      }
    }
  }
  const complete = renderToStaticMarkup(createElement(DataTable, { data: [{ name: "a", n: -2 }, { name: "b", n: 2 }], totals: true }));
  assert.match(complete, /<tfoot><tr><th scope="row">Total<\/th><td class="pl-num">0<\/td>/);
});

test("the gallery renders specimens, HTML, and the catalog in every theme", async () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "planloft-gallery-test-"));
  try {
    const { indexPath } = await buildGallery({ outDir });
    const themes = fs.readdirSync(path.resolve(import.meta.dirname, "../themes"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    assert.ok(themes.length >= 6);
    const index = fs.readFileSync(indexPath, "utf8");
    for (const theme of themes) {
      const specimen = fs.readFileSync(path.join(outDir, "specimen", `${theme}.html`), "utf8");
      const authoredHtml = fs.readFileSync(path.join(outDir, "html", `${theme}.html`), "utf8");
      const catalog = fs.readFileSync(path.join(outDir, "components", `${theme}.html`), "utf8");
      assert.match(specimen, /<article class="planloft-prose">[\s\S]*<h1>/, `${theme} specimen renders a body`);
      assert.match(authoredHtml, /planloft-render:head:start/, `${theme} HTML receives theme support`);
      assert.match(catalog, /class="ts-chart pl-chart__svg"/, `${theme} catalog contains rendered charts`);
      assert.match(index, new RegExp(`href="specimen/${theme}\\.html"`));
    }
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
});


test("tooltip values retain tiny measurements and all available significant digits", () => {
  const format = exactNumberFormatter({});
  for (const value of [1e-21, 1.2345678901234568e-10, Number.MIN_VALUE, -1e-21]) {
    assert.equal(Number(format(value).replace("−", "-")), value);
  }
  assert.equal(exactNumberFormatter({ format: "currency" })(12), "$12.00");
  assert.match(exactNumberFormatter({ format: "percent" })(1e-24), /1E.22%/);
});

test("every overlapping stacked target exposes every segment value", () => {
  for (const orientation of ["vertical", "horizontal"] as const) {
    const html = renderToStaticMarkup(createElement(BarChart, { data: [{ x: "A", a: 0.001, b: 0.001, c: 100 }], x: "x", y: ["a", "b", "c"], layout: "stacked", orientation }));
    for (const frame of framesOf(html)) {
      const hits = hitsOf(frame);
      assert.equal(hits.length, 3);
      for (const hit of hits) {
        // Whichever segment wins SVG hit testing provides the entire stack.
        assert.deepEqual(hit.lines, ["A", "A: 0.001", "B: 0.001", "C: 100", "Total: 100.002"]);
      }
    }
  }
});

test("line charts reject repeated category labels before plotting", () => {
  for (const area of [true, false]) {
    assert.throws(() => renderToStaticMarkup(createElement(LineChart, { data: [{x:"A",n:1},{x:"B",n:2},{x:"A",n:3}], x:"x",y:"n",area })), /unique categories.*Combine repeated/);
  }
});
