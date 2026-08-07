import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";
import { readCanonicalDocument, type SourceFlags } from "../commands/source.js";
import { ingestDocument, sourceFormatFromPath } from "./ingest.js";

const SCHEMA_ID = "https://github.com/hatim-s/planloft/schemas/document.v1.schema.json";

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

test("Markdown metadata is normalized and present blank metadata is rejected", () => {
  const normalized = ingestDocument(
    "---\ntitle: '  Trimmed title  '\nkind: '  roadmap  '\n---\n\nBody\n",
    { format: "md" },
  );
  assert.equal(normalized.title, "Trimmed title");
  assert.equal(normalized.kind, "roadmap");
  assert.throws(
    () => ingestDocument("---\ntitle: '   '\n---\n\n# Not a fallback\n", { format: "md" }),
    /metadata "title" must be a nonblank string/,
  );
});

test("title inference uses the first parsed Markdown H1 only", () => {
  const doc = ingestDocument(
    "```md\n# Not this\n```\n\n## Also not this\n\n# Actual title\n",
    { format: "md", sourceName: "fallback.md" },
  );
  assert.equal(doc.title, "Actual title");

  const html = ingestDocument("# Not a Markdown heading", {
    format: "html",
    sourceName: "legacy.html",
    trustedHtml: true,
  });
  assert.equal(html.title, "legacy");
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

test("versioned document fixtures agree through runtime and actual JSON Schema validation", async () => {
  const schemaDirectory = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../schemas",
  );
  const schema = JSON.parse(
    fs.readFileSync(path.join(schemaDirectory, "document.v1.schema.json"), "utf8"),
  ) as { $id: string };
  const fixtures = JSON.parse(
    fs.readFileSync(path.join(schemaDirectory, "document.fixtures.json"), "utf8"),
  ) as DocumentFixtures;
  assert.equal(schema.$id, SCHEMA_ID);

  const validateSchema = new Ajv2020({ allErrors: true }).compile(schema);
  for (const fixture of fixtures.valid) {
    assert.equal(
      validateSchema(fixture.document),
      true,
      `schema rejected valid fixture: ${fixture.name}: ${JSON.stringify(validateSchema.errors)}`,
    );
    const runtime = ingestDocument(JSON.stringify(fixture.document), {
      format: "json",
      trustedHtml: fixture.trustedHtml,
    });
    assert.deepEqual(
      pickMetadata(runtime),
      fixture.expected,
      `runtime normalization drifted for valid fixture: ${fixture.name}`,
    );
  }

  for (const fixture of fixtures.invalid) {
    assert.equal(validateSchema(fixture.document), false, `schema accepted invalid fixture: ${fixture.name}`);
    assert.throws(
      () => ingestDocument(JSON.stringify(fixture.document), { format: "json" }),
      new RegExp(fixture.error ?? `metadata "${fixture.field}"`),
      `runtime accepted invalid fixture: ${fixture.name}`,
    );
  }

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "planloft-document-cli-fixtures-"));
  const source = path.join(directory, "source.md");
  fs.writeFileSync(source, "# CLI source\n\nBody\n");
  try {
    for (const fixture of fixtures.valid.filter((entry) => entry.cliMetadata)) {
      const runtime = await readCanonicalDocument(source, fixture.cliMetadata ?? {});
      for (const [field, value] of Object.entries(fixture.expected)) {
        assert.equal(
          runtime[field as keyof typeof runtime],
          value,
          `CLI metadata normalization drifted for ${fixture.name}.${field}`,
        );
      }
    }
    for (const fixture of fixtures.invalid.filter((entry) => entry.cliMetadata)) {
      await assert.rejects(
        readCanonicalDocument(source, fixture.cliMetadata ?? {}),
        new RegExp(`metadata "${fixture.field}"`),
        `CLI metadata accepted invalid fixture: ${fixture.name}`,
      );
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

interface DocumentFixtures {
  valid: Array<{
    name: string;
    trustedHtml?: boolean;
    document: Record<string, unknown>;
    expected: Record<string, string>;
    cliMetadata?: SourceFlags;
  }>;
  invalid: Array<{
    name: string;
    document: Record<string, unknown>;
    field?: string;
    error?: string;
    cliMetadata?: SourceFlags;
  }>;
}

function pickMetadata(doc: ReturnType<typeof ingestDocument>): Record<string, string> {
  return {
    title: doc.title,
    slug: doc.slug,
    kind: doc.kind,
    ...(doc.theme === undefined ? {} : { theme: doc.theme }),
    status: doc.status,
  };
}
