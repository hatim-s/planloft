import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { ingestDocument } from "../src/core/ingest.js";
import { renderDocument } from "../src/render/renderer.js";

test("trusted HTML can replace the 1.1.0 controls block and detects edits to it", () => {
  const source = "<!doctype html><html><head><title>A page</title></head><body><main>Authored content</main></body></html>";
  const render = (html: string) => renderDocument(ingestDocument(html, {
    format: "html", sourceName: "page.html", trustedHtml: true,
  }), "minimal");
  const current = render(source);
  const oldControls = readFileSync(new URL("./fixtures/reader-controls-1.1.0.html", import.meta.url), "utf8");
  const legacy = current.replace(/(<!-- planloft-render:controls:start -->)[\s\S]*?(<!-- planloft-render:controls:end -->)/,
    (_block, start, end) => start + oldControls + end);
  assert.notEqual(legacy, current);
  assert.equal(render(legacy), current);
  assert.throws(() => render(legacy.replace("System theme", "Edited theme")), /Invalid Planloft render block/);
});
