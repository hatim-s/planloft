import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { hoistDocument } from "./hoist.js";
import { loadIndex } from "./store.js";
import { normalizeDocFile } from "./doc.js";
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
    assert.equal(Object.values(loadIndex().projects)[0]?.docs["imported-plan"]?.file, meta.file);

    const projectIdentity = projectKey(project);
    const normalized = normalizeDocFile(meta.file, projectIdentity.key, projectIdentity.label);
    assert.equal(normalized?.trustedHtml, false);
  } finally {
    if (previousHome === undefined) delete process.env.PLANLOFT_HOME;
    else process.env.PLANLOFT_HOME = previousHome;
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(project, { recursive: true, force: true });
  }
});
