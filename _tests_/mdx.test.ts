import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createPlanloftApplication } from "../src/application.js";
import { renderMdxDocument } from "../src/mdx/index.js";
import { ingestDocument } from "../src/core/ingest.js";

test("MDX requires explicit trust, including in JSON documents", () => {
  assert.throws(() => ingestDocument("# Hello", { format: "mdx" }), /MDX executes code/);
  assert.throws(() => ingestDocument('{"contentFormat":"mdx","content":"# Hello"}', { format: "json" }), /MDX executes code/);
});

test("MDX resolves local components and stored snapshots survive removal of source dependencies", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "planloft-mdx-"));
  const cwd = path.join(root, "project");
  fs.mkdirSync(cwd);
  const file = path.join(cwd, "example.mdx");
  fs.writeFileSync(path.join(cwd, "card.tsx"), 'import { useId } from \"react\"; export function Card({children}: {children: React.ReactNode}) { return <aside data-id={useId()}>{children}</aside> }');
  fs.writeFileSync(file, 'import {Card} from "./card.tsx"\n\n# Example\n\n<Card>Local content</Card>');
  let publishedHtml = "";
  const app = createPlanloftApplication({
    cwd, planloftHome: path.join(root, "home"), openUrl: () => false,
    publicationAdapter: {
      basePath: () => "/",
      deploy: async ({ dist }) => {
        publishedHtml = fs.readFileSync(path.join(dist, "index.html"), "utf8");
        return { url: "https://example.test/plan", expiresAt: "2030-01-01T00:00:00.000Z" };
      },
    },
  });
  try {
    await assert.rejects(app.hoist(file), /MDX executes code/);
    const stored = await app.hoist(file, { trustedMdx: true });
    fs.rmSync(path.join(cwd, "card.tsx"));
    const preview = await app.preview(stored.document.slug);
    assert.match(fs.readFileSync(path.join(preview.directory, "index.html"), "utf8"), /<aside[^>]*>Local content<\/aside>/);
    await app.deploy(stored.document.slug);
    assert.match(publishedHtml, /<aside[^>]*>Local content<\/aside>/);
    const copied = await app.copy(stored.document.slug);
    const rendered = await app.render(copied.path, { trustedMdx: true });
    assert.equal(rendered.output, "stdout");
    if (rendered.output === "stdout") assert.match(rendered.html, /<aside[^>]*>Local content<\/aside>/);
    fs.appendFileSync(stored.document.file, "\nEdited\n");
    await assert.rejects(app.preview(stored.document.slug), /changed since its dependencies were compiled/);
    fs.rmSync(preview.directory, { recursive: true, force: true });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("GFM tables, task lists, strikethrough, and autolinks render in MDX", async () => {
  const source = "# GFM\n\n| Name | Value |\n| --- | --- |\n| A | 2 |\n\n- [x] Done\n\n~~removed~~\n\nhttps://example.org\n";
  const doc = ingestDocument(source, { format: "mdx", trustedMdx: true });
  const html = await renderMdxDocument(doc, "minimal");
  assert.match(html, /<table>/);
  assert.match(html, /type="checkbox"[^>]*checked/);
  assert.match(html, /<del>removed<\/del>/);
  assert.match(html, /href="https:\/\/example\.org"/);
});

test("Badge renders inline in prose, GFM table cells, and HTML table cells", async () => {
  const source = [
    "Search ships <Badge color=\"green\">beta</Badge> next week.",
    "",
    "| Area | Labels |",
    "| --- | --- |",
    "| API | <Badge color=\"blue\">v2</Badge> <Badge>internal</Badge> |",
    "",
    "<table><tbody><tr><td>Web</td><td><Badge color=\"accent\">pilot</Badge></td></tr></tbody></table>",
    "",
  ].join("\n");
  const html = await renderMdxDocument(ingestDocument(source, { format: "mdx", trustedMdx: true }), "minimal");
  assert.match(html, /<p>Search ships <span class="pl-badge" data-color="green">beta<\/span> next week\.<\/p>/);
  assert.match(html, /<td><span class="pl-badge" data-color="blue">v2<\/span> <span class="pl-badge" data-color="gray">internal<\/span><\/td>/);
  assert.match(html, /<td><span class="pl-badge" data-color="accent">pilot<\/span><\/td>/);
  // The pill reads the theme aliases, so it must be one of the alias roots.
  assert.match(html, /\.pl-status, \.pl-badge,[^{]*\{\s*--pl-ink:/);
  await assert.rejects(
    renderMdxDocument(ingestDocument('<Badge color="chartreuse">x</Badge>', { format: "mdx", trustedMdx: true }), "minimal"),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "MDX_COMPONENT_INPUT" && /<Badge>/.test(error.message),
  );
});

test("project registry overrides the global registry and local MDX imports resolve beside the source", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "planloft-registry-"));
  const project = path.join(root, "project");
  const home = path.join(root, "home");
  fs.mkdirSync(path.join(project, ".planloft/components"), { recursive: true });
  fs.mkdirSync(path.join(home, "components"), { recursive: true });
  fs.writeFileSync(path.join(home, "components/index.tsx"), 'export const Badge = () => <b>global</b>; export const Global = () => <em>global only</em>;');
  fs.writeFileSync(path.join(project, ".planloft/components/index.tsx"), 'export const Badge = () => <b>project</b>;');
  fs.writeFileSync(path.join(project, "nested.mdx"), 'Nested **MDX**');
  const source = 'import Nested from "./nested.mdx"\n\n# Registry\n\n<Badge />\n\n<Global />\n\n<Nested />\n';
  const doc = ingestDocument(source, { format: "mdx", trustedMdx: true });
  try {
    const { withPlanloftHome } = await import("../src/core/paths.js");
    const html = await withPlanloftHome(home, () => renderMdxDocument(doc, "minimal", { sourcePath: path.join(project, "doc.mdx"), projectRoot: project }));
    assert.match(html, /<b>project<\/b>/);
    assert.match(html, /<em>global only<\/em>/);
    assert.match(html, /Nested <strong>MDX<\/strong>/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("public compile and hoist agree on the serialized body and reject mismatched snapshots before writing", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "planloft-public-mdx-"));
  const home = path.join(root, "home");
  try {
    const { compileMdx } = await import("../src/index.js");
    const { hoistDocument } = await import("../src/persistence.js");
    const { withPlanloftHome } = await import("../src/core/paths.js");
    const { buildSiteAsync } = await import("../src/render/renderer.js");
    const doc = ingestDocument("# Hello", { format: "mdx", trustedMdx: true });
    doc.compiledMdx = await withPlanloftHome(home, () => compileMdx(doc.content, { projectRoot: root }));
    const stored = withPlanloftHome(home, () => hoistDocument(doc, { cwd: root }));
    const site = await withPlanloftHome(home, () => buildSiteAsync({ doc: stored, theme: "minimal", base: "/" }));
    assert.match(fs.readFileSync(path.join(site, "index.html"), "utf8"), /<h1>Hello<\/h1>/);
    fs.rmSync(site, { recursive: true, force: true });
    doc.content = "# Changed";
    assert.throws(() => withPlanloftHome(home, () => hoistDocument(doc, { cwd: root })), /changed since its dependencies were compiled/);
    assert.match(fs.readFileSync(stored.file, "utf8"), /# Hello/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("application uses the Git root registry and the document directory for imports", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "planloft-nested-mdx-"));
  try {
    const { execFileSync } = await import("node:child_process");
    execFileSync("git", ["init", "-q", root]);
    const nested = path.join(root, "nested");
    fs.mkdirSync(nested);
    fs.mkdirSync(path.join(root, ".planloft/components"), { recursive: true });
    fs.writeFileSync(path.join(root, ".planloft/components/index.tsx"), 'export const Badge = () => <b>root registry</b>;');
    fs.writeFileSync(path.join(nested, "local.tsx"), 'export const Local = () => <i>local import</i>;');
    fs.writeFileSync(path.join(nested, "doc.mdx"), 'import { Local } from "./local.tsx"\n\n# Nested\n\n<Badge />\n\n<Local />\n');
    const app = createPlanloftApplication({ cwd: nested, planloftHome: path.join(root, "home") });
    const output = await app.render("doc.mdx", { trustedMdx: true });
    assert.equal(output.output, "stdout");
    if (output.output === "stdout") {
      assert.match(output.html, /<b>root registry<\/b>/);
      assert.match(output.html, /<i>local import<\/i>/);
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("expected MDX failures have bounded diagnostics and arbitrary component exceptions stay redacted", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "planloft-errors-"));
  const file = path.join(root, "doc.mdx");
  const app = createPlanloftApplication({ cwd: root, planloftHome: path.join(root, "home") });
  try {
    fs.writeFileSync(file, "# Hi\n\n<Broken>");
    await assert.rejects(app.render(file, { trustedMdx: true }), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /MDX syntax error at line 3, column 1/);
      assert.equal("code" in error && error.code, "MDX_SYNTAX");
      return true;
    });
    fs.writeFileSync(file, 'import X from "./SECRET_missing.tsx"\n\n<X />');
    await assert.rejects(app.render(file, { trustedMdx: true }), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /import could not be resolved/);
      assert.doesNotMatch(error.message, /SECRET/);
      assert.equal("code" in error && error.code, "MDX_IMPORT");
      return true;
    });
    fs.writeFileSync(file, "<Absent />");
    await assert.rejects(app.render(file, { trustedMdx: true }), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal("code" in error && error.code, "MDX_COMPONENT");
      return true;
    });
    fs.writeFileSync(path.join(root, "bad.tsx"), 'export function Bad() { throw new Error("SECRET_component"); }');
    fs.writeFileSync(file, 'import { Bad } from "./bad.tsx"\n\n<Bad />');
    await assert.rejects(app.render(file, { trustedMdx: true }), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.doesNotMatch(error.message, /SECRET/);
      assert.match(error.message, /local effect/);
      return true;
    });
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("CLI reports trusted MDX diagnostics and redacts forged errors", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "planloft-cli-mdx-"));
  try {
    const { createProgram } = await import("../src/program.js");
    const { MdxAuthoringError } = await import("../src/mdx/index.js");
    fs.writeFileSync(path.join(root, "doc.mdx"), "# Hello\n\n<Broken>");
    let output = "";
    const app = createPlanloftApplication({ cwd: root, planloftHome: path.join(root, "home") });
    await createProgram({ application: app, writeErr: value => { output += value; }, setExitCode: () => {} }).parseAsync(["node", "planloft", "render", "doc.mdx", "--trusted-mdx"]);
    assert.match(output, /\[MDX_SYNTAX\].*line 3, column 1/);
    const forged = new MdxAuthoringError("MDX_SYNTAX");
    forged.message = "SECRET_forged";
    output = "";
    const mocked = { ...app, render: async () => { throw forged; } };
    await createProgram({ application: mocked, writeErr: value => { output += value; }, setExitCode: () => {} }).parseAsync(["node", "planloft", "render", "doc.mdx", "--trusted-mdx"]);
    assert.doesNotMatch(output, /SECRET_forged/);
    assert.match(output, /internal application error/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("syntax diagnostics map frontmatter and identify safe imported files", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "planloft-mdx-location-"));
  const app = createPlanloftApplication({ cwd: root, planloftHome: path.join(root, "home") });
  try {
    const file = path.join(root, "doc.mdx");
    fs.writeFileSync(file, "---\ntitle: Test\n---\n\n# Heading\n\n<Broken>\n");
    for (const operation of [() => app.render(file, { trustedMdx: true }), () => app.hoist(file, { trustedMdx: true })]) {
      await assert.rejects(operation(), (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /line 7, column 1/);
        assert.doesNotMatch(error.message, new RegExp(root));
        return true;
      });
    }
    fs.mkdirSync(path.join(root, "parts"));
    fs.writeFileSync(path.join(root, "parts", "broken.mdx"), "# Nested\n\n<Broken>\n");
    fs.writeFileSync(file, 'import Nested from "./parts/broken.mdx"\n\n<Nested />\n');
    await assert.rejects(app.render(file, { trustedMdx: true }), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /in imported MDX parts\/broken\.mdx at line 3, column 1/);
      assert.doesNotMatch(error.message, new RegExp(root));
      return true;
    });
    fs.writeFileSync(path.join(root, "parts", "bad name.mdx"), "# Nested\n\n<Broken>\n");
    fs.writeFileSync(file, 'import Nested from "./parts/bad name.mdx"\n\n<Nested />\n');
    await assert.rejects(app.render(file, { trustedMdx: true }), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /in an imported MDX file at line 3, column 1/);
      assert.doesNotMatch(error.message, /bad name|planloft-mdx-location/);
      return true;
    });
    fs.writeFileSync(path.join(root, "doc.json"), JSON.stringify({ contentFormat: "mdx", content: "# Heading\n\n<Broken>" }));
    await assert.rejects(app.render("doc.json", { trustedMdx: true }), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /MDX syntax error/);
      assert.doesNotMatch(error.message, /line \d/);
      return true;
    });
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("built-in input errors identify the component without exposing supplied data", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "planloft-component-diagnostic-"));
  const file = path.join(root, "doc.mdx");
  const app = createPlanloftApplication({ cwd: root, planloftHome: path.join(root, "home") });
  try {
    for (const [name, props] of [
      ["DonutChart", 'data={[{name:"a",SECRET_n:-5}]} label="name" value="SECRET_n"'],
      ["WaterfallChart", 'data={[{name:"a",SECRET_n:null}]} label="name" value="SECRET_n"'],
      ["Heatmap", 'data={[{x:"a",y:"b",SECRET_n:null}]} x="x" y="y" value="SECRET_n"'],
    ]) {
      fs.writeFileSync(file, `<${name} ${props} />`);
      await assert.rejects(app.render(file, { trustedMdx: true }), (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal("code" in error && error.code, "MDX_COMPONENT_INPUT");
        assert.match(error.message, new RegExp(`Invalid data or props for <${name}>`));
        assert.doesNotMatch(error.message, /SECRET_n/);
        return true;
      });
    }
    fs.writeFileSync(path.join(root, "bad.tsx"), 'export function Bad() { throw new Error("<DonutChart> SECRET_fake"); }');
    fs.writeFileSync(file, 'import { Bad } from "./bad.tsx"\n\n<Bad />');
    await assert.rejects(app.render(file, { trustedMdx: true }), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.doesNotMatch(error.message, /SECRET_fake|DonutChart/);
      assert.match(error.message, /local effect/);
      return true;
    });
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
