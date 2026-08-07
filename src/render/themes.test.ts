import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  DEFAULT_LAYOUT,
  ThemeError,
  listAvailableThemes,
  readLayout,
  readStyle,
  readTemplate,
  resolveThemeDirectory,
} from "./themes.js";

test("built-in themes resolve to real directories and are listed", () => {
  for (const theme of ["minimal", "detailed", "editorial"]) {
    assert.equal(fs.statSync(resolveThemeDirectory(theme)).isDirectory(), true);
    assert.ok(listAvailableThemes().includes(theme));
    assert.notEqual(readTemplate(theme), "");
    assert.notEqual(readStyle(theme), "");
  }
});

test("a real user theme overrides a built-in and receives optional asset defaults", () => {
  withHome((home) => {
    const override = path.join(home, "themes", "minimal");
    fs.mkdirSync(override, { recursive: true });
    fs.writeFileSync(path.join(override, "template.md"), "User override");

    assert.equal(resolveThemeDirectory("minimal"), override);
    assert.equal(readTemplate("minimal"), "User override");
    assert.equal(readStyle("minimal"), "");
    assert.equal(readLayout("minimal"), DEFAULT_LAYOUT);
  });
});

test("invalid and unknown themes are explicit and missing errors list choices", () => {
  assertThemeError(() => resolveThemeDirectory("../minimal"), "PLANLOFT_THEME_INVALID_NAME");
  assertThemeError(
    () => resolveThemeDirectory("does-not-exist"),
    "PLANLOFT_THEME_MISSING",
    /Available themes: detailed, editorial, minimal/,
  );
});

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

test("present optional assets surface read failures instead of falling back", () => {
  withHome((home) => {
    const theme = path.join(home, "themes", "broken-style");
    fs.mkdirSync(path.join(theme, "style.css"), { recursive: true });
    assertThemeError(() => readStyle("broken-style"), "PLANLOFT_THEME_INACCESSIBLE");
  });
});

test("constrained layouts reject missing body and invalid slots", () => {
  withHome((home) => {
    const theme = path.join(home, "themes", "layout-test");
    fs.mkdirSync(theme, { recursive: true });
    fs.writeFileSync(path.join(theme, "layout.html"), "<main>{{title}}</main>");
    assertThemeError(() => readLayout("layout-test"), "PLANLOFT_THEME_INVALID_LAYOUT", /must contain/);

    fs.writeFileSync(path.join(theme, "layout.html"), "<main>{{body}}{{execute}}</main>");
    assertThemeError(() => readLayout("layout-test"), "PLANLOFT_THEME_INVALID_LAYOUT", /unknown slot/);

    fs.writeFileSync(path.join(theme, "layout.html"), "<main>{{body}}{{ execute }}</main>");
    assertThemeError(() => readLayout("layout-test"), "PLANLOFT_THEME_INVALID_LAYOUT", /unknown slot/);

    fs.writeFileSync(path.join(theme, "layout.html"), "<main>{{body}}{{title</main>");
    assertThemeError(() => readLayout("layout-test"), "PLANLOFT_THEME_INVALID_LAYOUT", /malformed slot/);
  });
});

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
