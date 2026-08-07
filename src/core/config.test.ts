import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { config as editConfig } from "../commands/config.js";
import {
  ConfigError,
  DEFAULT_CONFIG,
  ensureConfig,
  loadConfig,
  saveConfig,
  updateConfig,
} from "./config.js";

test("absent configuration alone receives defaults", () => {
  withHome((home) => {
    assert.deepEqual(loadConfig(), DEFAULT_CONFIG);
    assert.equal(fs.existsSync(path.join(home, "config.json")), false);

    assert.deepEqual(ensureConfig(), DEFAULT_CONFIG);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(home, "config.json"), "utf8")), DEFAULT_CONFIG);
  });
});

test("malformed configuration has a stable diagnostic and is never defaulted", () => {
  withHome((home) => {
    const file = path.join(home, "config.json");
    fs.writeFileSync(file, "{");
    assertConfigError(() => loadConfig(), "PLANLOFT_CONFIG_MALFORMED");
    assert.equal(fs.readFileSync(file, "utf8"), "{");
  });
});

test("inaccessible configuration has a stable diagnostic and is never defaulted", () => {
  withHome((home) => {
    fs.mkdirSync(path.join(home, "config.json"));
    assertConfigError(() => loadConfig(), "PLANLOFT_CONFIG_INACCESSIBLE");
    assert.equal(fs.statSync(path.join(home, "config.json")).isDirectory(), true);
  });
});

test("semantically invalid configuration reports the contract failure", () => {
  withHome((home) => {
    const file = path.join(home, "config.json");
    fs.writeFileSync(file, JSON.stringify({ ...DEFAULT_CONFIG, version: 2 }));
    assertConfigError(() => loadConfig(), "PLANLOFT_CONFIG_INVALID", /\$config\.version must equal 1/);

    fs.writeFileSync(file, JSON.stringify({ ...DEFAULT_CONFIG, surprise: true }));
    assertConfigError(() => loadConfig(), "PLANLOFT_CONFIG_INVALID", /unknown property "surprise"/);

    fs.writeFileSync(file, JSON.stringify({ ...DEFAULT_CONFIG, defaultTtlDays: 0 }));
    assertConfigError(() => loadConfig(), "PLANLOFT_CONFIG_INVALID", /finite positive integer/);
  });
});

test("the shipped JSON Schema declares the same versioned root contract", () => {
  const schemaPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../schemas/config.schema.json");
  const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8")) as {
    required: string[];
    additionalProperties: boolean;
    properties: { version: { const: number }; defaultTtlDays: { maximum: number } };
  };
  assert.deepEqual(schema.required, ["version", "theme", "planFormat", "defaultTtlDays", "projects"]);
  assert.equal(schema.additionalProperties, false);
  assert.equal(schema.properties.version.const, 1);
  assert.equal(schema.properties.defaultTtlDays.maximum, 100_000_000);
});

test("save validates before an atomic replacement", () => {
  withHome((home) => {
    const file = path.join(home, "config.json");
    saveConfig(DEFAULT_CONFIG);
    const before = fs.readFileSync(file, "utf8");

    assertConfigError(
      () => saveConfig({ ...DEFAULT_CONFIG, theme: "../escape" }),
      "PLANLOFT_CONFIG_INVALID",
      /PLANLOFT_THEME_INVALID_NAME/,
    );
    assert.equal(fs.readFileSync(file, "utf8"), before);
    assert.deepEqual(fs.readdirSync(home), ["config.json"]);

    saveConfig({ ...DEFAULT_CONFIG, theme: "editorial" });
    assert.equal(loadConfig().theme, "editorial");
    assert.deepEqual(fs.readdirSync(home), ["config.json"]);
  });
});

test("targeted updates preserve unrelated valid settings and merge nested settings", () => {
  withHome(() => {
    saveConfig({
      ...DEFAULT_CONFIG,
      github: { repo: "plans", user: "hatim", token: "secret" },
      giscus: { repo: "hatim/plans", repoId: "repo-id" },
      projects: {
        project: {
          theme: "minimal",
          giscus: { category: "Reviews", categoryId: "category-id" },
        },
      },
    });

    const updated = updateConfig({
      theme: "editorial",
      github: { repo: "new-plans" },
      projects: { project: { theme: "detailed" } },
    });

    assert.equal(updated.theme, "editorial");
    assert.deepEqual(updated.github, { repo: "new-plans", user: "hatim", token: "secret" });
    assert.deepEqual(updated.giscus, { repo: "hatim/plans", repoId: "repo-id" });
    assert.deepEqual(updated.projects.project, {
      theme: "detailed",
      giscus: { category: "Reviews", categoryId: "category-id" },
    });
    assert.deepEqual(loadConfig(), updated);
  });
});

test("config command validates the file after the editor closes", () => {
  withHome((home) => {
    saveConfig(DEFAULT_CONFIG);
    const editor = path.join(home, "invalid-editor.sh");
    fs.writeFileSync(editor, '#!/bin/sh\nprintf "{" > "$1"\n', { mode: 0o755 });
    const previousEditor = process.env.EDITOR;
    const previousVisual = process.env.VISUAL;
    process.env.EDITOR = editor;
    delete process.env.VISUAL;
    try {
      assertConfigError(() => editConfig(), "PLANLOFT_CONFIG_MALFORMED");
    } finally {
      if (previousEditor === undefined) delete process.env.EDITOR;
      else process.env.EDITOR = previousEditor;
      if (previousVisual === undefined) delete process.env.VISUAL;
      else process.env.VISUAL = previousVisual;
    }
  });
});

function assertConfigError(
  operation: () => unknown,
  code: ConfigError["code"],
  detail?: RegExp,
): void {
  assert.throws(operation, (error: unknown) => {
    assert.ok(error instanceof ConfigError);
    assert.equal(error.code, code);
    assert.match(error.message, new RegExp(`^\\[${code}\\]`));
    if (detail) assert.match(error.message, detail);
    return true;
  });
}

function withHome(run: (home: string) => void): void {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "planloft-config-test-"));
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
