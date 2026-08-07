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

test("comments are off by default", () => {
  const html = renderDocument(document({}), "minimal");
  assert.doesNotMatch(html, /giscus\.app\/client\.js/);
  assert.doesNotMatch(html, /planloft-comments/);
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

test("comments are appended when a custom constrained layout omits the comments slot", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "planloft-comments-layout-test-"));
  const previousHome = process.env.PLANLOFT_HOME;
  process.env.PLANLOFT_HOME = home;
  try {
    const theme = path.join(home, "themes", "no-comments-slot");
    fs.mkdirSync(theme, { recursive: true });
    fs.writeFileSync(path.join(theme, "style.css"), "");
    fs.writeFileSync(path.join(theme, "layout.html"), "<html><body>{{body}}</body></html>");
    const html = renderDocument(document({}), "no-comments-slot", {
      comments: {
        repo: "owner/repository",
        repoId: "repo-id",
        category: "Plan reviews",
        categoryId: "category-id",
      },
    });
    assert.match(html, /giscus\.app\/client\.js/);
    assert.ok(html.indexOf("planloft-comments") < html.indexOf("</body>"));
  } finally {
    if (previousHome === undefined) delete process.env.PLANLOFT_HOME;
    else process.env.PLANLOFT_HOME = previousHome;
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("noindex is injected when a custom constrained layout omits the robots slot", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "planloft-robots-layout-test-"));
  const previousHome = process.env.PLANLOFT_HOME;
  process.env.PLANLOFT_HOME = home;
  try {
    const theme = path.join(home, "themes", "no-robots-slot");
    fs.mkdirSync(theme, { recursive: true });
    fs.writeFileSync(path.join(theme, "style.css"), "");
    fs.writeFileSync(
      path.join(theme, "layout.html"),
      "<!doctype html><html><head><title>{{title}}</title></head><body>{{body}}</body></html>",
    );
    const html = renderDocument(document({}), "no-robots-slot", { noindex: true });
    assert.match(html, /<meta name="robots" content="noindex, nofollow" \/>/);
    assert.ok(html.indexOf('name="robots"') < html.indexOf("</head>"));
  } finally {
    if (previousHome === undefined) delete process.env.PLANLOFT_HOME;
    else process.env.PLANLOFT_HOME = previousHome;
    fs.rmSync(home, { recursive: true, force: true });
  }
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

test("body-only custom layouts retain theme styles, system preference, and the top toggle", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "planloft-body-only-layout-test-"));
  const previousHome = process.env.PLANLOFT_HOME;
  process.env.PLANLOFT_HOME = home;
  try {
    const theme = path.join(home, "themes", "body-only");
    fs.mkdirSync(theme, { recursive: true });
    fs.writeFileSync(path.join(theme, "style.css"), "article { color: rebeccapurple; }");
    fs.writeFileSync(path.join(theme, "layout.html"), "{{body}}");

    const html = renderDocument(document({ content: "Body content" }), "body-only");
    const buttonIndex = html.indexOf('class="planloft-theme-toggle"');
    const bodyIndex = html.indexOf("<p>Body content</p>");
    assert.match(html, /<style>[\s\S]*article \{ color: rebeccapurple; \}/);
    assert.match(html, /prefers-color-scheme: dark/);
    assert.match(html, /:root \{ color-scheme: light dark; \}/);
    assert.ok(buttonIndex >= 0 && buttonIndex < bodyIndex);
    assert.match(html, /Theme: system/);
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
