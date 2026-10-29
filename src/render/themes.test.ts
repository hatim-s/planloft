import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  ThemeError,
  listAvailableThemes,
  readStyle,
  resolveThemeDirectory,
  validateTheme,
} from "./themes.js";

test("built-in themes resolve to real directories and are listed", () => withHome(() => {
  const expected = ["briefing", "decision", "detailed", "editorial", "minimal", "research"];
  for (const theme of expected) {
    assert.equal(fs.statSync(resolveThemeDirectory(theme)).isDirectory(), true);
    assert.ok(listAvailableThemes().includes(theme));
    assert.notEqual(readStyle(theme), "");
    assert.match(readStyle(theme), /planloft-color-schemes: light dark/);
    assert.doesNotThrow(() => validateTheme(theme));
  }
}));

test("a real user theme overrides a built-in and receives optional asset defaults", () => {
  withHome((home) => {
    const override = path.join(home, "themes", "minimal");
    fs.mkdirSync(override, { recursive: true });

    assert.equal(resolveThemeDirectory("minimal"), override);
    assert.equal(readStyle("minimal"), "");
  });
});

test("invalid and unknown themes are explicit and missing errors list choices", () => withHome(() => {
  assertThemeError(() => resolveThemeDirectory("../minimal"), "PLANLOFT_THEME_INVALID_NAME");
  assertThemeError(
    () => resolveThemeDirectory("does-not-exist"),
    "PLANLOFT_THEME_MISSING",
    /Available themes: briefing, decision, detailed, editorial, minimal, research/,
  );
}));

test("a theme name must point to a directory", () => {
  withHome((home) => {
    fs.mkdirSync(path.join(home, "themes"), { recursive: true });
    fs.writeFileSync(path.join(home, "themes", "not-a-directory"), "file");
    assertThemeError(
      () => resolveThemeDirectory("not-a-directory"),
      "PLANLOFT_THEME_INVALID_ASSET",
      /must be a directory/,
    );
  });
});

test("a dangling user theme symlink is inaccessible instead of falling back", () => {
  withHome((home) => {
    const themes = path.join(home, "themes");
    fs.mkdirSync(themes, { recursive: true });
    fs.symlinkSync(path.join(home, "missing-theme"), path.join(themes, "minimal"));

    assertThemeError(
      () => resolveThemeDirectory("minimal"),
      "PLANLOFT_THEME_INACCESSIBLE",
    );
    assertThemeError(() => listAvailableThemes(), "PLANLOFT_THEME_INACCESSIBLE");
  });
});

test("present optional assets surface read failures instead of falling back", () => {
  withHome((home) => {
    const theme = path.join(home, "themes", "broken-style");
    fs.mkdirSync(path.join(theme, "style.css"), { recursive: true });
    assertThemeError(() => readStyle("broken-style"), "PLANLOFT_THEME_INACCESSIBLE");
  });
});

test("dangling optional asset symlinks are inaccessible instead of receiving defaults", () => {
  withHome((home) => {
    const theme = path.join(home, "themes", "dangling-assets");
    fs.mkdirSync(theme, { recursive: true });
    const file = path.join(theme, "style.css");
    fs.symlinkSync(path.join(theme, "missing-style"), file);
    assertThemeError(() => readStyle("dangling-assets"), "PLANLOFT_THEME_INACCESSIBLE");
  });
});

test("legacy assets require migration without modifying them", () => withHome((home) => {
  const theme = path.join(home, "themes", "legacy");
  fs.mkdirSync(theme, { recursive: true });
  for (const asset of ["template.md", "template.mdx", "layout.html"]) {
    const file = path.join(theme, asset);
    fs.writeFileSync(file, "authored content");
    assertThemeError(() => validateTheme("legacy"), "PLANLOFT_THEME_LEGACY_ASSET", /Back it up.*Markdown, MDX, or HTML/);
    assert.equal(fs.readFileSync(file, "utf8"), "authored content");
    fs.unlinkSync(file);
  }
}));

function assertThemeError(
  operation: () => unknown,
  code: ThemeError["code"],
  detail?: RegExp,
): void {
  assert.throws(operation, (error: unknown) => {
    assert.ok(error instanceof ThemeError);
    assert.equal(error.code, code);
    assert.match(error.message, new RegExp(`^\\[${code}\\]`));
    if (detail) assert.match(error.message, detail);
    return true;
  });
}

function withHome(run: (home: string) => void): void {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "planloft-theme-test-"));
  const previousHome = process.env.PLANLOFT_HOME;
  process.env.PLANLOFT_HOME = home;
  try {
    run(home);
  } finally {
    if (previousHome === undefined) delete process.env.PLANLOFT_HOME;
    else process.env.PLANLOFT_HOME = previousHome;
    fs.rmSync(home, { recursive: true, force: true });
  }
}
