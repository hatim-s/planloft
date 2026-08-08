import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createDocumentPersistence, hoistDocument } from "../persistence.js";
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
