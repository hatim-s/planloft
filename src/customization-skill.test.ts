import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import matter from "gray-matter";
import { ingestDocument } from "./core/ingest.js";
import { withPlanloftHome } from "./core/paths.js";
import { renderDocument } from "./render/renderer.js";
import { validateTheme } from "./render/themes.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const SKILL = path.join(ROOT, "skills", "planloft-customise");

test("planloft-customise has focused metadata and progressive references", () => {
  const source = fs.readFileSync(path.join(SKILL, "SKILL.md"), "utf8");
  const parsed = matter(source);
  assert.deepEqual(Object.keys(parsed.data).sort(), ["description", "name"]);
  assert.equal(parsed.data.name, "planloft-customise");
  assert.match(String(parsed.data.description), /how Planloft works/i);
  assert.match(source, /references\/how-planloft-works\.md/);
  assert.match(source, /references\/themes\.md/);
  assert.match(source, /assets\/theme-starter/);
  assert.match(source, /Never publish or deploy/);

  const metadata = fs.readFileSync(path.join(SKILL, "agents", "openai.yaml"), "utf8");
  assert.match(metadata, /display_name: "planloft:customise"/);
  assert.match(metadata, /\$planloft-customise/);
});

test("the shipped theme starter satisfies the runtime theme and renderer contracts", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "planloft-customization-skill-"));
  try {
    const theme = path.join(home, "themes", "starter");
    fs.mkdirSync(path.dirname(theme), { recursive: true });
    fs.cpSync(path.join(SKILL, "assets", "theme-starter"), theme, { recursive: true });

    withPlanloftHome(home, () => {
      validateTheme("starter");
      const doc = ingestDocument(
        "# Theme check\n\nA [link](https://example.com).\n\n> Quote\n\n| A | B |\n|---|---|\n| 1 | 2 |",
        { format: "md" },
      );
      const html = renderDocument(doc, "starter");
      assert.match(html, /planloft-color-schemes: light dark/);
      assert.match(html, /data-planloft-color-scheme="dark"/);
      assert.match(html, /planloft-theme-toggle/);
      assert.match(html, /<article><h1>Theme check<\/h1>/);
    });
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
