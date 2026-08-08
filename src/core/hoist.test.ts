import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DEFAULT_CONFIG } from "../configuration.js";
import { createDocumentPersistence, hoistDocument } from "../persistence.js";
import { indexPath } from "./paths.js";
import { projectKey } from "./project.js";

test("hoisting persists canonical source and indexes it for the project", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "planloft-home-test-"));
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "planloft-project-test-"));
  const previousHome = process.env.PLANLOFT_HOME;
  process.env.PLANLOFT_HOME = home;
  try {
    const meta = hoistDocument(
      {
        version: 1,
        title: "Imported plan",
        slug: "imported-plan",
        kind: "plan",
        status: "active",
        contentFormat: "md",
        content: "# Goal\n\nShip.",
        trustedHtml: false,
      },
      { cwd: project },
    );

    assert.equal(meta.slug, "imported-plan");
    assert.equal(meta.trustedHtml, false);
    assert.equal(fs.existsSync(meta.file), true);
    assert.match(fs.readFileSync(meta.file, "utf8"), /title: Imported plan/);
    assert.equal(
      fs.readFileSync(path.join(home, "config.json"), "utf8"),
      JSON.stringify(DEFAULT_CONFIG, null, 2) + "\n",
    );
    assert.equal(Object.values(createDocumentPersistence({ cwd: project }).list().projects)[0]?.docs["imported-plan"]?.file, meta.file);

    const projectIdentity = projectKey(project);
    const normalized = createDocumentPersistence({ cwd: project }).capture(meta.file);
    assert.equal(normalized?.trustedHtml, false);
  } finally {
    if (previousHome === undefined) delete process.env.PLANLOFT_HOME;
    else process.env.PLANLOFT_HOME = previousHome;
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(project, { recursive: true, force: true });
  }
});

test("compatibility hoist validates an invalid theme without persisting defaults", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "planloft-compat-hoist-validation-test-"));
  const home = path.join(root, "home");
  const project = path.join(root, "project");
  const previousHome = process.env.PLANLOFT_HOME;
  process.env.PLANLOFT_HOME = home;
  fs.mkdirSync(project, { recursive: true });
  try {
    assert.throws(
      () => hoistDocument({
        version: 1,
        title: "Invalid",
        slug: "invalid",
        kind: "plan",
        status: "active",
        theme: "missing-theme",
        contentFormat: "md",
        content: "# Invalid",
        trustedHtml: false,
      }, { cwd: project }),
      /PLANLOFT_THEME_MISSING/,
    );
    assert.equal(fs.existsSync(home), false);
  } finally {
    if (previousHome === undefined) delete process.env.PLANLOFT_HOME;
    else process.env.PLANLOFT_HOME = previousHome;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("the persistence interface preserves capture metadata and replaces document formats coherently", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "planloft-persistence-interface-test-"));
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "planloft-persistence-project-test-"));
  const previousHome = process.env.PLANLOFT_HOME;
  process.env.PLANLOFT_HOME = home;
  try {
    const persistence = createDocumentPersistence({
      cwd: project,
      clock: () => new Date("2034-05-06T07:08:09.000Z"),
    });
    const capture = path.join(home, "docs", persistence.project().label, "kept.md");
    fs.mkdirSync(path.dirname(capture), { recursive: true });
    fs.writeFileSync(capture, "---\ntitle: Kept\nowner: Hatim\n---\n# Kept\n");
    const captured = persistence.capture(capture);
    assert.equal(captured?.updatedAt, "2034-05-06T07:08:09.000Z");
    assert.match(fs.readFileSync(capture, "utf8"), /owner: Hatim/);

    const replacement = persistence.hoist({
      version: 1,
      title: "Kept HTML",
      slug: "kept",
      kind: "plan",
      status: "active",
      contentFormat: "html",
      content: "<h1>Trusted replacement</h1>",
      trustedHtml: true,
    });
    assert.match(replacement.file, /kept\.html$/);
    assert.equal(fs.existsSync(capture), false);
    assert.equal(fs.readFileSync(replacement.file, "utf8"), "<h1>Trusted replacement</h1>");
    assert.equal(persistence.find("kept")?.trustedHtml, true);

    const removed = persistence.remove("kept");
    assert.equal(removed?.sourceRemoved, true);
    assert.equal(persistence.find("kept"), undefined);
  } finally {
    if (previousHome === undefined) delete process.env.PLANLOFT_HOME;
    else process.env.PLANLOFT_HOME = previousHome;
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(project, { recursive: true, force: true });
  }
});

test("write-direct HTML to Markdown replacement preserves metadata and deletes old format after indexing", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "planloft-capture-html-md-test-"));
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "planloft-capture-html-md-project-"));
  const previousHome = process.env.PLANLOFT_HOME;
  process.env.PLANLOFT_HOME = home;
  try {
    const persistence = createDocumentPersistence({ cwd: project });
    const html = persistence.hoist({
      version: 1,
      title: "Preserved title",
      slug: "same-slug",
      kind: "proposal",
      status: "draft",
      theme: "minimal",
      contentFormat: "html",
      content: "<h1>Old HTML</h1>",
      trustedHtml: true,
    });
    const markdown = path.join(path.dirname(html.file), "same-slug.md");
    fs.writeFileSync(markdown, "# New Markdown\n");

    const captured = persistence.capture(markdown, new Date("2038-04-05T06:07:08.000Z"));
    assert.equal(captured?.file, path.resolve(markdown));
    assert.equal(captured?.format, "md");
    assert.equal(captured?.title, "Preserved title");
    assert.equal(captured?.kind, "proposal");
    assert.equal(captured?.status, "draft");
    assert.equal(captured?.theme, "minimal");
    assert.equal(captured?.trustedHtml, true);
    assert.equal(fs.existsSync(html.file), false);
    assert.match(fs.readFileSync(markdown, "utf8"), /title: Preserved title/);
    assert.match(fs.readFileSync(markdown, "utf8"), /kind: proposal/);
    const docs = persistence.list().projects[persistence.project().key]?.docs ?? {};
    assert.deepEqual(Object.keys(docs), ["same-slug"]);
    assert.equal(docs["same-slug"]?.file, path.resolve(markdown));
  } finally {
    if (previousHome === undefined) delete process.env.PLANLOFT_HOME;
    else process.env.PLANLOFT_HOME = previousHome;
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(project, { recursive: true, force: true });
  }
});

test("failed write-direct index update keeps the previously indexed format", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "planloft-capture-order-test-"));
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "planloft-capture-order-project-"));
  const previousHome = process.env.PLANLOFT_HOME;
  process.env.PLANLOFT_HOME = home;
  try {
    const persistence = createDocumentPersistence({ cwd: project });
    const html = persistence.hoist({
      version: 1,
      title: "Still indexed",
      slug: "ordered",
      kind: "plan",
      status: "active",
      contentFormat: "html",
      content: "<h1>Old HTML</h1>",
      trustedHtml: true,
    });
    const markdown = path.join(path.dirname(html.file), "ordered.md");
    fs.writeFileSync(markdown, "# Replacement\n");
    const failing = createDocumentPersistence({
      cwd: project,
      fileSystem: {
        readText: (file) => fs.readFileSync(file, "utf8"),
        readBytes: (file) => fs.readFileSync(file),
        writeText: (file, contents) => {
          if (file === indexPath()) throw new Error("simulated index failure");
          fs.writeFileSync(file, contents);
        },
        writeBytes: (file, contents) => fs.writeFileSync(file, contents),
        exists: (file) => fs.existsSync(file),
        makeDirectory: (directory) => fs.mkdirSync(directory, { recursive: true }),
        removeFile: (file) => fs.rmSync(file),
      },
    });

    assert.throws(() => failing.capture(markdown), /simulated index failure/);
    assert.equal(fs.existsSync(html.file), true);
    assert.equal(persistence.find("ordered")?.file, html.file);
  } finally {
    if (previousHome === undefined) delete process.env.PLANLOFT_HOME;
    else process.env.PLANLOFT_HOME = previousHome;
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(project, { recursive: true, force: true });
  }
});
