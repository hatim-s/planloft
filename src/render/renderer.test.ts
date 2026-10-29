import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildSite, renderDocument } from "./renderer.js";
import type { CanonicalDocument, DocMeta } from "../core/types.js";

test("untrusted Markdown escapes raw HTML and removes unsafe links", () => {
  const html = renderDocument(
    document({
      content: '<script>alert("x")</script>\n\n[bad](javascript:alert(1)) [good](https://example.com)',
    }),
    "minimal",
  );

  assert.doesNotMatch(html, /<article>[\s\S]*<script>/);
  assert.doesNotMatch(html, /javascript:/);
  assert.match(html, /href="https:\/\/example.com"/);
});

test("stored HTML receives theme support", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "planloft-legacy-html-test-"));
  const source = path.join(directory, "legacy.html");
  fs.writeFileSync(source, '<section data-legacy="true"><h1>Stored HTML</h1></section>');
  const meta: DocMeta = {
    slug: "legacy",
    title: "Legacy HTML",
    kind: "plan",
    project: "legacy-project",
    status: "active",
    format: "html",
    file: source,
    updatedAt: "2026-08-08T00:00:00.000Z",
  };
  let site: string | undefined;
  try {
    site = await buildSite({ doc: meta, theme: "minimal" });
    const html = fs.readFileSync(path.join(site, "index.html"), "utf8");
    assert.match(html, /planloft-render:head:start/);
    assert.match(html, /<section data-legacy="true"><h1>Stored HTML<\/h1><\/section>/);
  } finally {
    if (site) fs.rmSync(site, { recursive: true, force: true });
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("trusted HTML rendering keeps authored structure", () => {
  const source = "<!doctype html>\n<html><head><title>Original</title></head><body><main>Exact</main></body></html>\n";
  const html = renderDocument(document({ contentFormat: "html", content: source, trustedHtml: true }), "minimal", {
    noindex: true,
  });
  assert.match(html, /planloft-render:head:start/);
  assert.match(html, /<main>Exact<\/main>/);
});

test("comments are off by default", () => {
  const html = renderDocument(document({}), "minimal");
  assert.doesNotMatch(html, /giscus\.app\/client\.js/);
  assert.doesNotMatch(html, /<section class="planloft-comments"/);
});

test("configured comments render the complete giscus integration with escaped attributes", () => {
  const html = renderDocument(document({}), "minimal", {
    comments: {
      repo: "owner/repository",
      repoId: 'repo-id"&<',
      category: 'Plan review "<&',
      categoryId: 'category-id"&<',
    },
  });
  assert.match(html, /src="https:\/\/giscus\.app\/client\.js"/);
  assert.match(html, /data-repo="owner\/repository"/);
  assert.match(html, /data-repo-id="repo-id&quot;&amp;&lt;"/);
  assert.match(html, /data-category="Plan review &quot;&lt;&amp;"/);
  assert.match(html, /data-category-id="category-id&quot;&amp;&lt;"/);
  assert.match(html, /data-mapping="pathname"/);
  assert.match(html, /data-theme="preferred_color_scheme"/);
  assert.match(html, /crossorigin="anonymous"/);
  assert.match(html, /\n  async>/);
  assert.doesNotMatch(html, /TODO\(impl\)/);
});

test("rendered documents expose a compact three-option theme selector", () => {
  for (const theme of ["briefing", "decision", "detailed", "editorial", "minimal", "research"]) {
    const html = renderDocument(document({ content: "# Both themes" }), theme);
    const bodyIndex = html.indexOf("<body");
    const selectorIndex = html.indexOf('class="planloft-theme-selector planloft-theme-toggle"');
    const mainIndex = html.indexOf('<main class="planloft-plan">');
    assert.ok(bodyIndex >= 0 && selectorIndex > bodyIndex && selectorIndex < mainIndex);
    assert.match(html, /prefers-color-scheme: dark/);
    assert.match(html, /data-planloft-color-scheme="light"/);
    assert.match(html, /data-planloft-color-scheme="dark"/);
    assert.match(html, /localStorage\.getItem\(key\)/);
    for (const option of ["light", "dark", "system"]) {
      assert.match(html, new RegExp(`data-planloft-theme-option="${option}"`));
    }
    assert.equal((html.match(/class="planloft-theme-option"/g) ?? []).length, 3);
    const themeSelector = html.slice(selectorIndex, html.indexOf("planloft-layout-selector", selectorIndex));
    assert.equal((themeSelector.match(/<svg viewBox=/g) ?? []).length, 3);
    assert.match(html, /saved === "light" \|\| saved === "dark" \? saved : "system"/);
    assert.match(html, /selected === "system"/);
    assert.match(html, /delete root\.dataset\.planloftColorScheme/);
  }
});

test("rendered documents carry a reading/full width control that only scripts reveal", () => {
  const html = renderDocument(document({ content: "# Width" }), "minimal");
  const start = html.indexOf('class="planloft-layout-selector"');
  const selector = html.slice(start, html.indexOf("<script>", start));
  assert.match(selector, /role="group" aria-label="Page width" data-planloft-layout-selector hidden>/);
  assert.match(selector, /data-planloft-layout-option="reading"[^>]*aria-pressed="true"/);
  assert.match(selector, /data-planloft-layout-option="full"[^>]*aria-pressed="false"/);
  assert.match(html, /const key = "planloft-layout";/);
  assert.match(html, /saved === "full" \? "full" : "reading"/);
  assert.match(html, /delete root\.dataset\.planloftLayout/);
  assert.match(html, /group\.hidden = false/);
  // The width contract is renderer CSS scoped to the default shell, so a custom theme
  // inherits it without opting in, a custom layout with another structure is left
  // alone, and a theme's own width rule is never overridden.
  assert.match(html, /:root\[data-planloft-layout="full"\] \.planloft-plan:has\(> article\) \{[^}]*max-width: none/);
  assert.match(html, /\.planloft-plan:has\(> article\) > article \{[^}]*max-width: var\(--planloft-measure, 44rem\)/);
  const contract = html.slice(html.indexOf("--planloft-gutter: clamp"), html.indexOf("</style>"));
  assert.doesNotMatch(contract, /\n\s*width:/);
  // Print must beat the full-mode screen rule: the same selector, so equal specificity,
  // declared later in the sheet, with zero inline padding.
  const fullSelector = ':root[data-planloft-layout="full"] .planloft-plan:has(> article)';
  const screenRule = contract.indexOf(`${fullSelector} {`);
  const printBlock = contract.indexOf("@media print");
  const printRule = contract.indexOf(`${fullSelector},\n  .planloft-plan:has(> article) { max-width: none; padding-inline: 0; }`);
  assert.ok(screenRule >= 0 && printBlock > screenRule && printRule > printBlock);
  assert.match(html, /\.planloft-controls \{ display: none; \}/);
});

test("authored HTML preserves source around idempotent theme and controls blocks", () => {
  const source = '<!doctype html><html><head><script>const s = "</head><body>";</script><style>:root { --ink: red }</style></head><body><!-- </body> --><main>Exact</main></body></html>';
  const doc = document({ contentFormat: "html", content: source, trustedHtml: true });
  const html = renderDocument(doc, "minimal", { noindex: true });
  assert.ok(html.indexOf('data-planloft-render') < html.indexOf('<style>:root'));
  assert.ok(html.includes('<script>const s = "</head><body>";</script><style>:root { --ink: red }</style>'));
  assert.ok(html.includes('<!-- </body> --><main>Exact</main>'));
  assert.doesNotMatch(html, /class="planloft-prose"/);
  assert.doesNotMatch(html, /Canvas !important/);
  const stripped = html.replace(/<!-- planloft-render:head:start -->[\s\S]*?<!-- planloft-render:head:end -->/, "").replace(/<!-- planloft-render:controls:start -->[\s\S]*?<!-- planloft-render:controls:end -->/, "");
  assert.equal(stripped, source);
  assert.equal(renderDocument({ ...doc, content: html }, "minimal", { noindex: true }), html);
  const rethemed = renderDocument({ ...doc, content: html }, "editorial");
  assert.equal((rethemed.match(/<!-- planloft-render:head:start -->/g) ?? []).length, 1);
  assert.match(rethemed, /--planloft-chart-1/);
  assert.match(rethemed, /data-planloft-layout-option="full"/);
  const fragment = '<p>Fragment</p><!-- </head> --><script>const tag = "<body>";</script>';
  const fragmentDoc = { ...doc, content: fragment };
  const fragmentHtml = renderDocument(fragmentDoc, "minimal");
  assert.equal(renderDocument({ ...fragmentDoc, content: fragmentHtml }, "minimal"), fragmentHtml);
  assert.equal(fragmentHtml.replace(/<!-- planloft-render:head:start -->[\s\S]*?<!-- planloft-render:head:end -->/, "").replace(/<!-- planloft-render:controls:start -->[\s\S]*?<!-- planloft-render:controls:end -->/, ""), fragment);
  assert.throws(() => renderDocument({ ...doc, content: html.replace('planloft-render:controls:end', 'planloft-render:controls:bad') }, "minimal"), /Invalid Planloft render markers/);
  assert.throws(() => renderDocument({ ...doc, content: source.replace('<main>', '<main data-planloft-theme-option="light">') }, "minimal"), /collide/);
});

test("omitted HTML tags remain recompilable without changing author bytes", () => {
  for (const source of ["<head></head><p>hi", "<!doctype html><html><head><title>x</title></head><p>hi</p></html>", "", "<!doctype html>", "<html></html>"]) {
    const doc = document({ contentFormat: "html", content: source, trustedHtml: true });
    const first = renderDocument(doc, "minimal");
    const stripped = first.replace(/<!-- planloft-render:head:start -->[\s\S]*?<!-- planloft-render:head:end -->/, "").replace(/<!-- planloft-render:controls:start -->[\s\S]*?<!-- planloft-render:controls:end -->/, "");
    assert.equal(stripped, source);
    assert.equal(renderDocument({ ...doc, content: first }, "minimal"), first);
    const rethemed = renderDocument({ ...doc, content: first }, "editorial");
    assert.equal(renderDocument({ ...doc, content: rethemed }, "editorial"), rethemed);
  }
});

test("Markdown output recompiles unchanged and edited generated CSS is rejected", () => {
  const markdown = renderDocument(document({ content: "# Hello" }), "minimal");
  const doc = document({ contentFormat: "html", content: markdown, trustedHtml: true });
  assert.equal(renderDocument(doc, "minimal"), markdown);
  const edited = markdown.replace("</style>", "/* authored addition */ body { color: hotpink }</style>");
  assert.throws(() => renderDocument({ ...doc, content: edited }, "editorial"), /PLANLOFT_RENDER_SUPPORT_CONFLICT.*Invalid Planloft render block/);
});

function document(overrides: Partial<CanonicalDocument>): CanonicalDocument {
  return {
    version: 1,
    sourceLineOffset: null,
    title: "Test",
    slug: "test",
    kind: "plan",
    status: "active",
    contentFormat: "md",
    content: "Text",
    trustedHtml: false,
    ...overrides,
  };
}
