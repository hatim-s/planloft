import assert from "node:assert/strict";
import test from "node:test";
import { ingestDocument, sourceFormatFromPath } from "./ingest.js";

test("Markdown frontmatter becomes a canonical document", () => {
  const doc = ingestDocument(
    `---\ntitle: Release plan\nkind: plan\ntheme: detailed\n---\n\n# Ignored heading\n\nShip it.\n`,
    { format: "md", sourceName: "release.md" },
  );

  assert.equal(doc.title, "Release plan");
  assert.equal(doc.slug, "release-plan");
  assert.equal(doc.kind, "plan");
  assert.equal(doc.theme, "detailed");
  assert.equal(doc.contentFormat, "md");
  assert.match(doc.content, /Ship it/);
});

test("JSON is a versioned Markdown envelope and explicit overrides win", () => {
  const doc = ingestDocument(
    JSON.stringify({
      version: 1,
      title: "JSON title",
      kind: "rfc",
      content: "# Body\n\nText",
    }),
    { format: "json", overrides: { title: "Caller title", theme: "minimal" } },
  );

  assert.equal(doc.title, "Caller title");
  assert.equal(doc.slug, "caller-title");
  assert.equal(doc.kind, "rfc");
  assert.equal(doc.theme, "minimal");
  assert.equal(doc.contentFormat, "md");
});

test("JSON rejects unknown fields and unsupported versions", () => {
  assert.throws(
    () => ingestDocument('{"content":"x","blocks":[]}', { format: "json" }),
    /Unknown JSON document field: blocks/,
  );
  assert.throws(
    () => ingestDocument('{"version":2,"content":"x"}', { format: "json" }),
    /Unsupported JSON document version: 2/,
  );
});

test("HTML requires an explicit trust decision", () => {
  assert.throws(
    () => ingestDocument("<p>trusted?</p>", { format: "html" }),
    /HTML input is disabled by default/,
  );
  assert.equal(
    ingestDocument("<p>trusted</p>", { format: "html", trustedHtml: true }).contentFormat,
    "html",
  );
});

test("source formats are inferred from supported file extensions", () => {
  assert.equal(sourceFormatFromPath("plan.md"), "md");
  assert.equal(sourceFormatFromPath("plan.markdown"), "md");
  assert.equal(sourceFormatFromPath("plan.json"), "json");
  assert.equal(sourceFormatFromPath("plan.html"), "html");
  assert.throws(() => sourceFormatFromPath("plan.txt"), /Cannot infer input format/);
});
