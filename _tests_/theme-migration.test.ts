import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createPlanloftApplication } from "../src/application.js";

const starter = path.resolve(import.meta.dirname, "../skills/planloft-customise/assets/theme-starter/style.css");

test("a separate token-only candidate renders before a legacy theme is replaced", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "planloft-theme-migration-"));
  const home = path.join(root, "home");
  const legacy = path.join(home, "themes", "legacy");
  const candidate = path.join(home, "themes", "candidate");
  fs.mkdirSync(legacy, { recursive: true });
  fs.mkdirSync(candidate, { recursive: true });
  const oldFiles = { "template.md": "# Authored material\n", "layout.html": "<main>{{body}}</main>", "style.css": "body { color: navy }" };
  for (const [name, content] of Object.entries(oldFiles)) fs.writeFileSync(path.join(legacy, name), content);
  fs.copyFileSync(starter, path.join(candidate, "style.css"));
  const app = createPlanloftApplication({ cwd: root, planloftHome: home });
  try {
    const files = { "sample.md": "# Markdown\n", "sample.mdx": "# MDX\n", "sample.html": "<!doctype html><html><head><style>p { color: red }</style></head><body><p>HTML</p><script>window.x = 1</script></body></html>" };
    for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(root, name), content);
    await assert.rejects(app.render("sample.md", { theme: "legacy" }), /PLANLOFT_THEME_LEGACY_ASSET.*template\.md, template\.mdx, or layout\.html.*Back it up/);
    for (const [name, content] of Object.entries(files)) {
      const result = await app.render(name, { theme: "candidate", trustedMdx: true, trustedHtml: true });
      assert.equal(result.output, "stdout");
      if (result.output === "stdout") {
        assert.match(result.html, /--planloft-ink/);
        assert.match(result.html, /planloft-render:controls:start/);
        if (name.endsWith(".html")) assert.ok(result.html.includes('<p>HTML</p><script>window.x = 1</script>'));
      }
      assert.equal(fs.readFileSync(path.join(root, name), "utf8"), content);
    }
    const mdx = await app.render("sample.mdx", { theme: "candidate", trustedMdx: true });
    assert.equal(mdx.output, "stdout");
    if (mdx.output === "stdout") {
      fs.writeFileSync(path.join(root, "compiled.html"), mdx.html);
      const recompiled = await app.render("compiled.html", { theme: "candidate", trustedHtml: true });
      assert.equal(recompiled.output, "stdout");
      if (recompiled.output === "stdout") {
        assert.equal(recompiled.html, mdx.html);
        assert.match(recompiled.html, /--pl-series-1: var\(--planloft-chart-1/);
        assert.match(recompiled.html, /\.pl-callout/);
        assert.match(recompiled.html, /data-planloft-layout-option="full"/);
      }
    }
    const reference = fs.readFileSync(path.resolve(import.meta.dirname, "../skills/planloft-write-doc/references/theme-variables.md"), "utf8");
    const example = /```html\n([\s\S]*?)\n```/.exec(reference)?.[1];
    assert.ok(example);
    fs.writeFileSync(path.join(root, "documented.html"), example);
    const documented = await app.render("documented.html", { theme: "candidate", trustedHtml: true });
    assert.equal(documented.output, "stdout");
    if (documented.output === "stdout") {
      assert.ok(documented.html.includes('<article class="planloft-prose">'));
      assert.ok(documented.html.indexOf("data-planloft-render") < documented.html.indexOf("body { margin: 0"));
      assert.match(documented.html, /\.planloft-prose/);
    }
    fs.writeFileSync(path.join(root, "old-output.html"), '<body><div class="planloft-controls">Old controls</div></body>');
    for (const operation of ["render", "hoist", "publish"] as const) {
      await assert.rejects(app[operation]("old-output.html", { theme: "candidate", trustedHtml: true }), /PLANLOFT_RENDER_SUPPORT_CONFLICT.*Regenerate from the original source/);
    }
    assert.equal(fs.existsSync(path.join(home, "index.json")), false);
    for (const [name, content] of Object.entries(oldFiles)) assert.equal(fs.readFileSync(path.join(legacy, name), "utf8"), content);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
