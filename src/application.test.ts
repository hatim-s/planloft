import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { stripVTControlCharacters } from "node:util";
import {
  APPLICATION_ERROR_CATEGORIES,
  PlanloftApplicationError,
  createPlanloftApplication,
} from "./application.js";
import { createProgram } from "./program.js";
import { DEFAULT_CONFIG, saveConfig } from "./configuration.js";
import { withPlanloftHome } from "./core/paths.js";
import {
  PublicationEffectError,
  updatePublicationManifest,
  type Manifest,
} from "./publication.js";
import type {
  ApplicationPublicationAdapter,
  ApplicationPublicationInput,
} from "./application.js";

test("application operations return structured results with scoped cwd, home, and clock", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "planloft-application-test-"));
  const home = path.join(root, "home");
  const cwd = path.join(root, "project");
  const source = path.join(cwd, "roadmap.md");
  const now = new Date("2030-02-03T04:05:06.000Z");
  fs.mkdirSync(cwd, { recursive: true });
  fs.writeFileSync(source, "# Roadmap\n\nShip it.\n");
  const previousHome = process.env.PLANLOFT_HOME;

  try {
    const application = createPlanloftApplication({ cwd, planloftHome: home, clock: () => now });
    const resolved = await application.resolve({ title: "Scoped Plan", kind: "plan" });
    assert.equal(resolved.operation, "resolve");
    assert.match(resolved.context.path, new RegExp(`^${escapeRegExp(home)}`));
    assert.equal(process.env.PLANLOFT_HOME, previousHome);

    const hoisted = await application.hoist(source);
    assert.equal(hoisted.operation, "hoist");
    assert.equal(hoisted.document.updatedAt, now.toISOString());
    assert.match(hoisted.document.file, new RegExp(`^${escapeRegExp(home)}`));

    const listed = await application.list({ kind: "plan" });
    assert.equal(listed.operation, "list");
    assert.equal(listed.projects.length, 1);
    assert.equal(listed.projects[0]?.documents[0]?.slug, "roadmap");
    assert.equal("file" in (listed.projects[0]?.documents[0] ?? {}), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("application publication is host-injectable and returns a secret-free result", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "planloft-application-publish-test-"));
  const home = path.join(root, "home");
  const cwd = path.join(root, "project");
  const source = path.join(cwd, "proposal.md");
  const now = new Date("2031-03-04T05:06:07.000Z");
  fs.mkdirSync(cwd, { recursive: true });
  fs.writeFileSync(source, "# Proposal\n\nPublic content.\n");
  withPlanloftHome(home, () =>
    saveConfig({
      version: 1,
      theme: "minimal",
      defaultTtlDays: 7,
      projects: {},
      github: { repo: "plans", token: "never-return-this-secret" },
    }),
  );
  let received: ApplicationPublicationInput | undefined;
  const host: ApplicationPublicationAdapter = {
    basePath: (id) => `/plans/${id}/`,
    deploy: async (input) => {
      received = input;
      return { url: "https://example.test/plan", expiresAt: "2031-03-11T05:06:07.000Z" };
    },
  };

  try {
    const application = createPlanloftApplication({
      cwd,
      planloftHome: home,
      clock: () => now,
      id: () => "fixed-id",
      publicationAdapter: host,
    });
    const result = await application.publish(source);
    assert.equal(result.operation, "publish");
    assert.equal(result.deployment.url, "https://example.test/plan");
    assert.equal(result.deployment.ttlDays, 7);
    assert.equal(received?.id, "fixed-id");
    assert.equal(received?.now, now);
    assert.equal(fs.existsSync(received?.dist ?? ""), false);
    assert.doesNotMatch(JSON.stringify(result), /never-return-this-secret/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("first application hoist and publish persist exact defaults after validation", async () => {
  for (const operation of ["hoist", "publish"] as const) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `planloft-first-${operation}-test-`));
    const home = path.join(root, "home");
    const cwd = path.join(root, "project");
    const source = path.join(cwd, `${operation}.md`);
    fs.mkdirSync(cwd, { recursive: true });
    fs.writeFileSync(source, `# First ${operation}\n`);
    const application = createPlanloftApplication({
      cwd,
      planloftHome: home,
      id: () => "first-id",
      publicationAdapter: {
        basePath: (id) => `/plans/${id}/`,
        deploy: async () => ({
          url: "https://example.test/first",
          expiresAt: "2030-01-31T00:00:00.000Z",
        }),
      },
    });

    try {
      await application[operation](source);
      const configSource = fs.readFileSync(path.join(home, "config.json"), "utf8");
      assert.equal(configSource, JSON.stringify(DEFAULT_CONFIG, null, 2) + "\n");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test("init keeps valid configuration by default and force resets only config.json", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "planloft-init-force-test-"));
  const home = path.join(root, "home");
  const cwd = path.join(root, "project");
  const config = path.join(home, "config.json");
  fs.mkdirSync(path.join(home, "docs", "example"), { recursive: true });
  fs.mkdirSync(path.join(home, "themes", "custom"), { recursive: true });
  fs.mkdirSync(path.join(home, "hosting", "plans"), { recursive: true });
  fs.mkdirSync(cwd, { recursive: true });

  const existing = {
    ...DEFAULT_CONFIG,
    theme: "editorial",
    defaultTtlDays: 14,
    projects: { example: { theme: "detailed" } },
    github: { repo: "existing-plans", token: "discard-on-explicit-reset" },
  };
  const existingSource = JSON.stringify(existing);
  fs.writeFileSync(config, existingSource);
  const preservedFiles = {
    [path.join(home, "index.json")]: '{"version":1}\n',
    [path.join(home, "docs", "example", "kept.md")]: "# Kept document\n",
    [path.join(home, "themes", "custom", "template.md")]: "Custom guidance\n",
    [path.join(home, "hosting", "plans", "README.md")]: "Hosting clone\n",
    [path.join(cwd, "project-file.txt")]: "Project content\n",
  };
  for (const [file, contents] of Object.entries(preservedFiles)) fs.writeFileSync(file, contents);

  const application = createPlanloftApplication({
    cwd,
    planloftHome: home,
    hasGithubCli: () => false,
  });

  try {
    const kept = await application.init();
    assert.equal(kept.configCreated, false);
    assert.equal(kept.configReinitialized, false);
    assert.equal(kept.theme, "editorial");
    assert.equal(fs.readFileSync(config, "utf8"), existingSource);

    const reset = await application.init({ force: true });
    assert.equal(reset.configCreated, false);
    assert.equal(reset.configReinitialized, true);
    assert.equal(reset.theme, DEFAULT_CONFIG.theme);
    const expected = JSON.stringify(DEFAULT_CONFIG, null, 2) + "\n";
    assert.equal(fs.readFileSync(config, "utf8"), expected);
    for (const [file, contents] of Object.entries(preservedFiles)) {
      assert.equal(fs.readFileSync(file, "utf8"), contents, `${file} must be preserved`);
    }

    await application.init({ force: true });
    assert.equal(fs.readFileSync(config, "utf8"), expected, "forced init must be deterministic");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("init --force repairs malformed configuration that ordinary init leaves untouched", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "planloft-init-force-malformed-test-"));
  const home = path.join(root, "home");
  const config = path.join(home, "config.json");
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(config, "{ stale");
  const application = createPlanloftApplication({ planloftHome: home, hasGithubCli: () => false });

  try {
    await assert.rejects(application.init(), (error: unknown) => {
      assert.ok(error instanceof PlanloftApplicationError);
      assert.equal(error.operation, "init");
      assert.equal(error.category, "configuration");
      assert.equal(error.diagnosticCode, "PLANLOFT_CONFIG_MALFORMED");
      return true;
    });
    assert.equal(fs.readFileSync(config, "utf8"), "{ stale");

    const reset = await application.init({ force: true });
    assert.equal(reset.configReinitialized, true);
    assert.equal(fs.readFileSync(config, "utf8"), JSON.stringify(DEFAULT_CONFIG, null, 2) + "\n");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("application publish samples the injected clock once and shares that instant", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "planloft-publish-clock-test-"));
  const home = path.join(root, "home");
  const cwd = path.join(root, "project");
  const source = path.join(cwd, "clock.md");
  fs.mkdirSync(cwd, { recursive: true });
  fs.writeFileSync(source, "# Clock\n");
  const instants = [
    new Date("2036-01-02T03:04:05.000Z"),
    new Date("2040-09-08T07:06:05.000Z"),
  ];
  let clockCalls = 0;
  let publicationNow: Date | undefined;
  const manifest: Manifest = { version: 1, deploys: [] };
  const application = createPlanloftApplication({
    cwd,
    planloftHome: home,
    clock: () => instants[clockCalls++]!,
    id: () => "clock-id",
    publicationAdapter: {
      basePath: (id) => `/plans/${id}/`,
      deploy: async (input) => {
        publicationNow = input.now;
        updatePublicationManifest(manifest, input, input.id);
        return {
          url: "https://example.test/clock",
          expiresAt: "2036-02-01T03:04:05.000Z",
        };
      },
    },
  });

  try {
    const result = await application.publish(source);
    assert.equal(clockCalls, 1);
    assert.equal(result.document.updatedAt, instants[0]!.toISOString());
    assert.equal(publicationNow, instants[0]);
    assert.equal(manifest.deploys[0]?.createdAt, instants[0]!.toISOString());
    assert.equal(manifest.deploys[0]?.expiresAt, "2036-02-01T03:04:05.000Z");
    assert.equal(result.deployment.expiresAt, "2036-02-01T03:04:05.000Z");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("application captures injected cwd and resolves relative render, hoist, and publish paths", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "planloft-application-relative-paths-test-"));
  const home = path.join(root, "home");
  const cwd = path.join(root, "project");
  const otherCwd = path.join(root, "other");
  fs.mkdirSync(cwd, { recursive: true });
  fs.mkdirSync(otherCwd, { recursive: true });
  fs.writeFileSync(path.join(cwd, "render.md"), "# Relative render\n");
  fs.writeFileSync(path.join(cwd, "hoist.md"), "# Relative hoist\n");
  fs.writeFileSync(path.join(cwd, "publish.md"), "# Relative publish\n");

  let injectedCwd = cwd;
  const application = createPlanloftApplication({
    cwd: () => injectedCwd,
    planloftHome: home,
    id: () => "relative-id",
    publicationAdapter: {
      basePath: (id) => `/plans/${id}/`,
      deploy: async () => ({
        url: "https://example.test/relative",
        expiresAt: "2032-01-08T00:00:00.000Z",
      }),
    },
  });
  injectedCwd = otherCwd;

  try {
    const rendered = await application.render("render.md", { out: "rendered" });
    assert.deepEqual(rendered, {
      operation: "render",
      output: "file",
      path: path.join(cwd, "rendered", "index.html"),
    });
    assert.equal(fs.existsSync(path.join(cwd, "rendered", "index.html")), true);
    assert.equal(fs.existsSync(path.join(otherCwd, "rendered", "index.html")), false);

    const hoisted = await application.hoist("hoist.md");
    assert.equal(hoisted.document.slug, "relative-hoist");

    const published = await application.publish("publish.md");
    assert.equal(published.document.slug, "relative-publish");
    assert.equal(published.deployment.url, "https://example.test/relative");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("application uses stable not-found and conflict error categories before copy writes", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "planloft-application-errors-test-"));
  const home = path.join(root, "home");
  const cwd = path.join(root, "project");
  fs.mkdirSync(cwd, { recursive: true });
  const application = createPlanloftApplication({ cwd, planloftHome: home });

  try {
    await assert.rejects(application.copy("missing"), (error: unknown) => {
      assertApplicationError(error, "not_found", "PLANLOFT_APPLICATION_NOT_FOUND");
      return true;
    });

    const source = path.join(cwd, "kept.md");
    fs.writeFileSync(source, "# Kept\n");
    await application.hoist(source);
    const first = await application.copy("kept");
    fs.writeFileSync(first.path, "local edit\n");
    await assert.rejects(application.copy("kept"), (error: unknown) => {
      assertApplicationError(error, "conflict", "PLANLOFT_APPLICATION_CONFLICT");
      return true;
    });
    assert.equal(fs.readFileSync(first.path, "utf8"), "local edit\n");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("deploy reports a missing indexed source as a local publication effect", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "planloft-deploy-local-effect-test-"));
  const home = path.join(root, "home");
  const cwd = path.join(root, "project");
  const source = path.join(cwd, "missing-after-index.md");
  fs.mkdirSync(cwd, { recursive: true });
  fs.writeFileSync(source, "# Missing after index\n");
  let hostCalls = 0;
  const application = createPlanloftApplication({
    cwd,
    planloftHome: home,
    id: () => "missing-id",
    publicationAdapter: {
      basePath: (id) => `/plans/${id}/`,
      deploy: async () => {
        hostCalls += 1;
        return { url: "https://example.test/unreachable", expiresAt: "never" };
      },
    },
  });

  try {
    const hoisted = await application.hoist(source);
    fs.rmSync(hoisted.document.file);
    await assert.rejects(application.deploy("missing-after-index"), (error: unknown) => {
      assertApplicationError(error, "local_effect", "PLANLOFT_APPLICATION_LOCAL_EFFECT");
      assert.equal(error.operation, "deploy");
      assert.equal(error.stage, "render");
      assert.equal(error.message, "Deploy failed during the render stage of a local effect.");
      assert.equal(error.cause, undefined);
      return true;
    });
    assert.equal(hostCalls, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("deploy reports an adapter failure as an external publication effect", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "planloft-deploy-external-effect-test-"));
  const home = path.join(root, "home");
  const cwd = path.join(root, "project");
  const source = path.join(cwd, "host-failure.md");
  fs.mkdirSync(cwd, { recursive: true });
  fs.writeFileSync(source, "# Host failure\n");
  const application = createPlanloftApplication({
    cwd,
    planloftHome: home,
    id: () => "host-failure-id",
    publicationAdapter: {
      basePath: (id) => `/plans/${id}/`,
      deploy: async () => {
        throw new Error("simulated host mutation failure");
      },
    },
  });

  try {
    await application.hoist(source);
    await assert.rejects(application.deploy("host-failure"), (error: unknown) => {
      assertApplicationError(error, "external_effect", "PLANLOFT_APPLICATION_EXTERNAL_EFFECT");
      assert.equal(error.operation, "deploy");
      assert.equal(error.stage, "host");
      assert.equal(error.message, "Deploy failed during the host stage of an external effect.");
      assert.equal(error.cause, undefined);
      return true;
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("publish reports a base-path provider failure before config, store, render, or host effects", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "planloft-publish-base-path-test-"));
  const home = path.join(root, "home");
  const cwd = path.join(root, "project");
  const artifacts = path.join(root, "artifacts");
  const source = path.join(cwd, "base-path-failure.md");
  fs.mkdirSync(cwd, { recursive: true });
  fs.mkdirSync(artifacts);
  fs.writeFileSync(source, "# Base path failure\n");
  const previousTmpdir = process.env.TMPDIR;
  process.env.TMPDIR = artifacts;
  let basePathCalls = 0;
  let hostCalls = 0;
  const application = createPlanloftApplication({
    cwd,
    planloftHome: home,
    id: () => "base-path-id",
    publicationAdapter: {
      basePath: () => {
        basePathCalls += 1;
        throw new Error("simulated base-path provider failure");
      },
      deploy: async () => {
        hostCalls += 1;
        return { url: "https://example.test/unreachable", expiresAt: "never" };
      },
    },
  });

  try {
    await assert.rejects(application.publish(source), (error: unknown) => {
      assertApplicationError(error, "external_effect", "PLANLOFT_APPLICATION_EXTERNAL_EFFECT");
      assert.equal(error.operation, "publish");
      assert.equal(error.stage, "host");
      assert.equal(error.message, "Publish failed during the host stage of an external effect.");
      assert.equal(error.cause, undefined);
      return true;
    });
    assert.equal(basePathCalls, 1);
    assert.equal(hostCalls, 0);
    assert.equal(fs.existsSync(home), false);
    assert.deepEqual(fs.readdirSync(artifacts), []);
    assert.equal(fs.readFileSync(source, "utf8"), "# Base path failure\n");
  } finally {
    if (previousTmpdir === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = previousTmpdir;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("deploy reports a base-path provider failure without mutating the store or leaking an artifact", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "planloft-deploy-base-path-test-"));
  const home = path.join(root, "home");
  const cwd = path.join(root, "project");
  const artifacts = path.join(root, "artifacts");
  const source = path.join(cwd, "indexed-base-path-failure.md");
  fs.mkdirSync(cwd, { recursive: true });
  fs.mkdirSync(artifacts);
  fs.writeFileSync(source, "# Indexed base path failure\n");
  const previousTmpdir = process.env.TMPDIR;
  process.env.TMPDIR = artifacts;
  let basePathCalls = 0;
  let hostCalls = 0;
  const application = createPlanloftApplication({
    cwd,
    planloftHome: home,
    id: () => "indexed-base-path-id",
    publicationAdapter: {
      basePath: () => {
        basePathCalls += 1;
        throw new Error("simulated indexed base-path provider failure");
      },
      deploy: async () => {
        hostCalls += 1;
        return { url: "https://example.test/unreachable", expiresAt: "never" };
      },
    },
  });

  try {
    await application.hoist(source);
    const storeBefore = snapshotDirectory(home);
    await assert.rejects(application.deploy("indexed-base-path-failure"), (error: unknown) => {
      assertApplicationError(error, "external_effect", "PLANLOFT_APPLICATION_EXTERNAL_EFFECT");
      assert.equal(error.operation, "deploy");
      assert.equal(error.stage, "host");
      assert.equal(error.message, "Deploy failed during the host stage of an external effect.");
      assert.equal(error.cause, undefined);
      return true;
    });
    assert.equal(basePathCalls, 1);
    assert.equal(hostCalls, 0);
    assert.deepEqual(snapshotDirectory(home), storeBefore);
    assert.deepEqual(fs.readdirSync(artifacts), []);
  } finally {
    if (previousTmpdir === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = previousTmpdir;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("hoist validates theme before creating default configuration or store state", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "planloft-application-hoist-validation-test-"));
  const home = path.join(root, "home");
  const source = path.join(root, "invalid-theme.md");
  fs.writeFileSync(source, "# Invalid theme\n");
  const application = createPlanloftApplication({ cwd: root, planloftHome: home });
  try {
    await assert.rejects(application.hoist(source, { theme: "missing-theme" }), (error: unknown) => {
      assert.ok(error instanceof PlanloftApplicationError);
      assert.equal(error.category, "validation");
      assert.match(error.message, /PLANLOFT_THEME_MISSING/);
      return true;
    });
    assert.equal(fs.existsSync(home), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("publish validates theme before creating default configuration or store state", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "planloft-application-publish-validation-test-"));
  const home = path.join(root, "home");
  const source = path.join(root, "invalid-theme.md");
  fs.writeFileSync(source, "# Invalid theme\n");
  const application = createPlanloftApplication({
    cwd: root,
    planloftHome: home,
    publicationAdapter: {
      basePath: (id) => `/plans/${id}/`,
      deploy: async () => ({ url: "https://example.test/unreachable", expiresAt: "never" }),
    },
  });
  try {
    await assert.rejects(application.publish(source, { theme: "missing-theme" }), (error: unknown) => {
      assert.ok(error instanceof PlanloftApplicationError);
      assert.equal(error.category, "validation");
      assert.match(error.message, /PLANLOFT_THEME_MISSING/);
      return true;
    });
    assert.equal(fs.existsSync(home), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("application error categories are a stable exhaustive vocabulary", () => {
  assert.deepEqual(APPLICATION_ERROR_CATEGORIES, [
    "validation",
    "not_found",
    "conflict",
    "configuration",
    "local_effect",
    "external_effect",
    "internal",
  ]);
});

test("public application and CLI error boundaries never expose adapter secrets or raw causes", async () => {
  const sentinel = "SECRET_TOKEN_auth-bearer_path-user-private";
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "planloft-secret-boundary-test-"));
  const home = path.join(root, "home");
  const cwd = path.join(root, "project");
  const source = path.join(cwd, "secret-boundary.md");
  fs.mkdirSync(cwd, { recursive: true });
  fs.writeFileSync(source, "# Secret boundary\n");
  const application = createPlanloftApplication({
    cwd,
    planloftHome: home,
    id: () => "secret-boundary-id",
    publicationAdapter: {
      basePath: (id) => `/plans/${id}/`,
      deploy: async () => {
        throw new Error(`Authorization: Bearer ${sentinel}; https://token@host.invalid/private`);
      },
    },
  });

  try {
    await application.hoist(source);
    await assert.rejects(application.deploy("secret-boundary"), (error: unknown) => {
      assertApplicationError(error, "external_effect", "PLANLOFT_APPLICATION_EXTERNAL_EFFECT");
      assert.equal(error.stage, "host");
      assertSecretFreeError(error, sentinel);
      return true;
    });

    let stderr = "";
    let exitCode: number | undefined;
    const program = createProgram({
      application,
      writeOut: () => undefined,
      writeErr: (value) => (stderr += value),
      setExitCode: (value) => (exitCode = value),
    });
    await program.parseAsync(["node", "planloft", "deploy", "secret-boundary"]);
    assert.equal(exitCode, 1);
    assert.match(stripVTControlCharacters(stderr), /Deploy failed: Deploy failed during the host stage of an external effect\./);
    assert.doesNotMatch(stderr, new RegExp(escapeRegExp(sentinel)));

    stderr = "";
    exitCode = undefined;
    const unexpectedProgram = createProgram({
      application: {
        ...application,
        deploy: async () => {
          throw new Error(`unexpected CLI adapter failure ${sentinel}`);
        },
      },
      writeOut: () => undefined,
      writeErr: (value) => (stderr += value),
      setExitCode: (value) => (exitCode = value),
    });
    await unexpectedProgram.parseAsync(["node", "planloft", "deploy", "secret-boundary"]);
    assert.equal(exitCode, 1);
    assert.match(stripVTControlCharacters(stderr), /Deploy failed: Deploy failed because of an internal application error\./);
    assert.doesNotMatch(stderr, new RegExp(escapeRegExp(sentinel)));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("authentication and local filesystem diagnostics preserve safe typing without token or path text", async () => {
  const sentinel = "SECRET_auth-token_private-path";
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "planloft-safe-diagnostics-test-"));
  const home = path.join(root, "home");
  const cwd = path.join(root, "project");
  const source = path.join(cwd, "auth.md");
  fs.mkdirSync(cwd, { recursive: true });
  fs.writeFileSync(source, "# Auth\n");
  const authApplication = createPlanloftApplication({
    cwd,
    planloftHome: home,
    id: () => "auth-id",
    publicationAdapter: {
      basePath: (id) => `/plans/${id}/`,
      deploy: async () => {
        throw new PublicationEffectError(
          "external_effect",
          "authentication",
          new Error(`PLANLOFT_GITHUB_AUTH_INVALID: rejected token ${sentinel}`),
        );
      },
    },
  });

  try {
    await authApplication.hoist(source);
    await assert.rejects(authApplication.deploy("auth"), (error: unknown) => {
      assertApplicationError(error, "external_effect", "PLANLOFT_APPLICATION_EXTERNAL_EFFECT");
      assert.equal(error.stage, "authentication");
      assert.equal(error.diagnosticCode, "PLANLOFT_GITHUB_AUTH_INVALID");
      assert.match(error.message, /GitHub rejected the configured credential/);
      assertSecretFreeError(error, sentinel);
      return true;
    });

    const sensitiveFile = path.join(cwd, `${sentinel}.md`);
    await assert.rejects(authApplication.render(sensitiveFile), (error: unknown) => {
      assertApplicationError(error, "local_effect", "PLANLOFT_APPLICATION_LOCAL_EFFECT");
      assert.equal(error.message, "Render failed during a local effect.");
      assertSecretFreeError(error, sentinel);
      return true;
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("public error constructor ignores non-allowlisted diagnostic metadata", () => {
  const sentinel = "SECRET_arbitrary-public-error";
  const error = new PlanloftApplicationError(
    "external_effect",
    "deploy",
    {
      stage: sentinel,
      diagnosticCode: sentinel,
      field: sentinel,
      cause: new Error(sentinel),
      message: sentinel,
      token: sentinel,
      url: `https://${sentinel}@example.test`,
    } as unknown as never,
  );
  assert.equal(error.stage, undefined);
  assert.equal(error.diagnosticCode, undefined);
  assert.equal(error.field, undefined);
  assertSecretFreeError(error, sentinel);

  const invalidVocabulary = new PlanloftApplicationError(
    sentinel as never,
    sentinel as never,
    null as never,
  );
  assert.equal(invalidVocabulary.category, "internal");
  assert.equal(invalidVocabulary.operation, "init");
  assertSecretFreeError(invalidVocabulary, sentinel);
});

function assertApplicationError(
  error: unknown,
  category: PlanloftApplicationError["category"],
  code: string,
): asserts error is PlanloftApplicationError {
  assert.ok(error instanceof PlanloftApplicationError);
  assert.equal(error.category, category);
  assert.equal(error.code, code);
}

function assertSecretFreeError(error: PlanloftApplicationError, sentinel: string): void {
  assert.equal(error.cause, undefined);
  assert.equal(Object.prototype.hasOwnProperty.call(error, "cause"), false);
  const ownProperties = Object.fromEntries(
    Object.getOwnPropertyNames(error).map((name) => [name, (error as unknown as Record<string, unknown>)[name]]),
  );
  for (const value of [
    error.message,
    error.stack ?? "",
    String(error),
    JSON.stringify(error),
    JSON.stringify(ownProperties),
  ]) {
    assert.doesNotMatch(value, new RegExp(escapeRegExp(sentinel)));
  }
}

function snapshotDirectory(root: string): Record<string, string> {
  const snapshot: Record<string, string> = {};
  const visit = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(root, absolute);
      if (entry.isDirectory()) {
        snapshot[`${relative}/`] = "directory";
        visit(absolute);
      } else {
        snapshot[relative] = fs.readFileSync(absolute).toString("base64");
      }
    }
  };
  visit(root);
  return snapshot;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
