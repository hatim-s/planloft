import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { renderDocument } from "./renderer.js";
import type { CanonicalDocument } from "../core/types.js";

test("a theme layout receives only constrained document slots", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "planloft-render-test-"));
  const previousHome = process.env.PLANLOFT_HOME;
  process.env.PLANLOFT_HOME = home;
  try {
    const theme = path.join(home, "themes", "test-theme");
    fs.mkdirSync(theme, { recursive: true });
    fs.writeFileSync(path.join(theme, "style.css"), "body { color: tomato; }");
    fs.writeFileSync(
      path.join(theme, "layout.html"),
      "<title>{{title}}</title><style>{{styles}}</style><main data-kind=\"{{kind}}\">{{body}}</main>{{robots}}{{comments}}",
    );

    const html = renderDocument(document({ title: "A < B", content: "# Hello" }), "test-theme", {
      noindex: true,
    });
    assert.match(html, /<title>A &lt; B<\/title>/);
    assert.match(html, /body \{ color: tomato; \}/);
    assert.match(html, /<h1>Hello<\/h1>/);
    assert.match(html, /noindex, nofollow/);
  } finally {
    if (previousHome === undefined) delete process.env.PLANLOFT_HOME;
    else process.env.PLANLOFT_HOME = previousHome;
    fs.rmSync(home, { recursive: true, force: true });
  }
});

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

test("rendered documents honor system theme and expose a top theme toggle", () => {
  for (const theme of ["minimal", "detailed", "editorial"]) {
    const html = renderDocument(document({ content: "# Both themes" }), theme);
    const bodyIndex = html.indexOf("<body");
    const buttonIndex = html.indexOf('class="planloft-theme-toggle"');
    const mainIndex = html.indexOf('<main class="planloft-plan">');
    assert.ok(bodyIndex >= 0 && buttonIndex > bodyIndex && buttonIndex < mainIndex);
    assert.match(html, /prefers-color-scheme: dark/);
    assert.match(html, /data-planloft-color-scheme="light"/);
    assert.match(html, /data-planloft-color-scheme="dark"/);
    assert.match(html, /localStorage\.getItem\(key\)/);
    assert.match(html, /Theme: system/);
  }
});

test("custom light-only themes receive a system dark fallback", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "planloft-theme-fallback-test-"));
  const previousHome = process.env.PLANLOFT_HOME;
  process.env.PLANLOFT_HOME = home;
  try {
    const theme = path.join(home, "themes", "light-only");
    fs.mkdirSync(theme, { recursive: true });
    fs.writeFileSync(path.join(theme, "style.css"), "body { color: #111; background: #fff; }");
    const html = renderDocument(document({}), "light-only");
    assert.match(html, /prefers-color-scheme: dark/);
    assert.match(html, /background: Canvas !important/);
    assert.match(html, /color: CanvasText !important/);
  } finally {
    if (previousHome === undefined) delete process.env.PLANLOFT_HOME;
    else process.env.PLANLOFT_HOME = previousHome;
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("theme layouts must include the body and may only use documented slots", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "planloft-layout-test-"));
  const previousHome = process.env.PLANLOFT_HOME;
  process.env.PLANLOFT_HOME = home;
  try {
    const theme = path.join(home, "themes", "invalid-theme");
    fs.mkdirSync(theme, { recursive: true });
    fs.writeFileSync(path.join(theme, "style.css"), "");
    fs.writeFileSync(path.join(theme, "layout.html"), "<main>{{title}}</main>");
    assert.throws(() => renderDocument(document({}), "invalid-theme"), /must contain \{\{body\}\}/);

    fs.writeFileSync(path.join(theme, "layout.html"), "<main>{{body}}{{execute}}</main>");
    assert.throws(() => renderDocument(document({}), "invalid-theme"), /unknown slot: \{\{execute\}\}/);
  } finally {
    if (previousHome === undefined) delete process.env.PLANLOFT_HOME;
    else process.env.PLANLOFT_HOME = previousHome;
    fs.rmSync(home, { recursive: true, force: true });
  }
});

function document(overrides: Partial<CanonicalDocument>): CanonicalDocument {
  return {
    version: 1,
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
