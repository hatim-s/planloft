import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  APPLICATION_ERROR_CATEGORIES,
  PlanloftApplicationError,
  createPlanloftApplication,
} from "./application.js";
import { DEFAULT_CONFIG, saveConfig } from "./configuration.js";
import { withPlanloftHome } from "./core/paths.js";
import { updatePublicationManifest, type Manifest } from "./publication.js";
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

function assertApplicationError(
  error: unknown,
  category: PlanloftApplicationError["category"],
  code: string,
): asserts error is PlanloftApplicationError {
  assert.ok(error instanceof PlanloftApplicationError);
  assert.equal(error.category, category);
  assert.equal(error.code, code);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
