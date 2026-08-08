import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";
import { createPlanloftApplication, PlanloftApplicationError } from "../application.js";
import {
  ConfigError,
  DEFAULT_CONFIG,
  createPlanloftConfiguration,
  ensureConfig,
  loadConfig,
  saveConfig,
  updateConfig,
  validateConfig,
} from "../configuration.js";

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

test("a dangling configuration symlink is inaccessible and is never overwritten", () => {
  withHome((home) => {
    const file = path.join(home, "config.json");
    const target = path.join(home, "missing-config.json");
    fs.symlinkSync(target, file);

    assertConfigError(() => loadConfig(), "PLANLOFT_CONFIG_INACCESSIBLE");
    assertConfigError(() => ensureConfig(), "PLANLOFT_CONFIG_INACCESSIBLE");
    assertConfigError(() => saveConfig(DEFAULT_CONFIG), "PLANLOFT_CONFIG_INACCESSIBLE");
    assert.equal(fs.lstatSync(file).isSymbolicLink(), true);
    assert.equal(fs.readlinkSync(file), target);
    assert.equal(fs.existsSync(target), false);
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

test("old HTML capture configuration produces an actionable migration diagnostic", () => {
  withHome((home) => {
    const file = path.join(home, "config.json");
    fs.writeFileSync(file, JSON.stringify({ ...DEFAULT_CONFIG, planFormat: "html" }));
    assertConfigError(
      () => loadConfig(),
      "PLANLOFT_CONFIG_MIGRATION_REQUIRED",
      /Remove planFormat.*agent-authored documents now resolve to Markdown.*--trusted-html/,
    );
    assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).planFormat, "html");
  });
});

test("shared config fixtures agree through runtime and actual JSON Schema validation", () => {
  const schemaPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../schemas/config.schema.json");
  const fixturesPath = path.resolve(path.dirname(schemaPath), "config.fixtures.json");
  const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
  const fixtures = JSON.parse(fs.readFileSync(fixturesPath, "utf8")) as {
    valid: Array<{ name: string; config: unknown }>;
    invalid: Array<{ name: string; config: unknown }>;
  };
  const validateSchema = new Ajv2020({ allErrors: true }).compile(schema);

  for (const fixture of fixtures.valid) {
    assert.doesNotThrow(() => validateConfig(fixture.config), `runtime rejected valid fixture: ${fixture.name}`);
    assert.equal(
      validateSchema(fixture.config),
      true,
      `schema rejected valid fixture: ${fixture.name}: ${JSON.stringify(validateSchema.errors)}`,
    );
  }
  for (const fixture of fixtures.invalid) {
    assertConfigError(
      () => validateConfig(fixture.config),
      "PLANLOFT_CONFIG_INVALID",
    );
    assert.equal(validateSchema(fixture.config), false, `schema accepted invalid fixture: ${fixture.name}`);
  }
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

test("targeted updates ignore explicit undefined values at every optional patch level", () => {
  withHome(() => {
    const initial = {
      ...DEFAULT_CONFIG,
      github: { repo: "plans", user: "hatim", token: "github-secret" },
      giscus: {
        repo: "hatim/plans",
        repoId: "repo-id",
        category: "Reviews",
        categoryId: "category-id",
      },
      vercel: { token: "vercel-secret" },
      projects: {
        project: {
          theme: "minimal",
          giscus: { category: "Project Reviews", categoryId: "project-category-id" },
        },
      },
    } satisfies Parameters<typeof saveConfig>[0];
    saveConfig(initial);

    const updated = updateConfig({
      theme: undefined,
      defaultTtlDays: undefined,
      github: { repo: "new-plans", user: undefined, token: undefined },
      giscus: { repo: undefined, repoId: undefined, category: undefined, categoryId: undefined },
      vercel: { token: undefined },
      projects: {
        project: {
          theme: undefined,
          giscus: { category: undefined, categoryId: undefined },
        },
        ignored: {
          theme: undefined,
          giscus: { category: undefined },
        },
      },
    });

    assert.deepEqual(updated, {
      ...initial,
      github: { ...initial.github, repo: "new-plans" },
    });
    assert.deepEqual(loadConfig(), updated);
  });
});

test("the configuration interface resolves project overrides and returns only redacted diagnostics", () => {
  withHome(() => {
    saveConfig({
      ...DEFAULT_CONFIG,
      theme: "minimal",
      projects: { project: { theme: "editorial" } },
      github: { repo: "plans", token: "configuration-secret" },
    });
    const configuration = createPlanloftConfiguration();
    const resolved = configuration.resolveAuthoring("project");
    assert.equal(resolved.theme, "editorial");
    assert.match(resolved.template, /Author Markdown only/);
    const diagnostic = JSON.stringify(configuration.redact(resolved.config));
    assert.match(diagnostic, /\[redacted\]/);
    assert.doesNotMatch(diagnostic, /configuration-secret/);
  });
});

test("config application operation validates the file after the editor closes", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "planloft-config-application-test-"));
  try {
    const application = createPlanloftApplication({
      planloftHome: home,
      environment: { EDITOR: "test-editor" },
      editFile: (_editor, file) => fs.writeFileSync(file, "{"),
    });
    await application.init();
    await assert.rejects(application.config(), (error: unknown) => {
      assert.ok(error instanceof PlanloftApplicationError);
      assert.equal(error.category, "configuration");
      assert.match(error.message, /PLANLOFT_CONFIG_MALFORMED/);
      return true;
    });
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
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
