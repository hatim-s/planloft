import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { createPlanloftApplication, PlanloftApplicationError } from "../src/application.js";
import { compileMdx, ingestDocument, hoistDocument, prepareDocument } from "../src/index.js";
import { withPlanloftHome } from "../src/core/paths.js";

function diagnostic(code: string, component?: string) {
  return (error: unknown) => {
    assert.ok(error instanceof PlanloftApplicationError);
    assert.equal(error.diagnosticCode, code);
    if (component) assert.equal(error.component, component);
    assert.doesNotMatch(JSON.stringify(error), /SECRET/);
    return true;
  };
}

test("copied source compiles fresh while the stored preview keeps its pinned registry", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "planloft-fresh-copy-"));
  const home = path.join(root, "home");
  execFileSync("git", ["init", "-q", root]);
  const registry = path.join(root, ".planloft/components/index.tsx");
  fs.mkdirSync(path.dirname(registry), { recursive: true });
  fs.writeFileSync(registry, 'export const Badge = () => <b>version-one</b>;');
  fs.writeFileSync(path.join(root, "doc.mdx"), "# Original\n\n<Badge />");
  const app = createPlanloftApplication({ cwd: root, planloftHome: home, openUrl: () => false });
  let preview: string | undefined;
  try {
    await app.hoist("doc.mdx", { trustedMdx: true });
    const copy = await app.copy("original");
    fs.writeFileSync(registry, 'export const Badge = () => <b>version-two</b>;');
    const fresh = await app.render(copy.path, { trustedMdx: true });
    assert.equal(fresh.output, "stdout");
    if (fresh.output === "stdout") assert.match(fresh.html, /<b>version-two<\/b>/);
    preview = (await app.preview("original")).directory;
    assert.match(fs.readFileSync(path.join(preview, "index.html"), "utf8"), /<b>version-one<\/b>/);
    fs.appendFileSync(copy.path, "\n\nEdited paragraph.");
    const updated = await app.hoist(copy.path, { trustedMdx: true });
    assert.match(fs.readFileSync(updated.document.file, "utf8"), /Edited paragraph/);
  } finally {
    if (preview) fs.rmSync(preview, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("adjacent snapshots rescue absent dependencies but never import or syntax diagnostics", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "planloft-fallback-"));
  const app = createPlanloftApplication({ cwd: root, planloftHome: path.join(root, "home") });
  const file = path.join(root, "doc.mdx");
  const child = path.join(root, "child.mdx");
  fs.writeFileSync(child, "<Badge>pinned child</Badge>");
  fs.writeFileSync(file, 'import Child from "./child.mdx"\n\n# Fallback\n\n<Child />');
  try {
    await app.hoist(file, { trustedMdx: true });
    const copy = await app.copy("fallback");
    const copiedChild = path.join(path.dirname(copy.path), "child.mdx");
    fs.writeFileSync(copiedChild, "<Broken>");
    await assert.rejects(app.render(copy.path, { trustedMdx: true }), diagnostic("MDX_SYNTAX"));
    fs.writeFileSync(copiedChild, 'import {Absent} from "./exports.js"\n\n<Absent />');
    fs.writeFileSync(path.join(path.dirname(copy.path), "exports.js"), "export const Present = 1;");
    await assert.rejects(app.render(copy.path, { trustedMdx: true }), error => {
      assert.ok(error instanceof PlanloftApplicationError);
      assert.equal(error.category, "local_effect");
      return true;
    });
    fs.rmSync(copiedChild);
    const recovered = await app.render(copy.path, { trustedMdx: true });
    assert.equal(recovered.output, "stdout");
    if (recovered.output === "stdout") assert.match(recovered.html, /pinned child/);
    const dependency = path.join(root, "node_modules/user-pkg");
    fs.mkdirSync(dependency, { recursive: true });
    fs.writeFileSync(path.join(dependency, "package.json"), '{"type":"module","main":"index.tsx"}');
    fs.writeFileSync(path.join(dependency, "index.tsx"), 'export {default} from "./unavailable.tsx";');
    fs.writeFileSync(copiedChild, 'import Part from "user-pkg"\n\n<Part />');
    const transitive = await app.render(copy.path, { trustedMdx: true });
    assert.equal(transitive.output, "stdout");
    if (transitive.output === "stdout") assert.match(transitive.html, /pinned child/);
    fs.appendFileSync(copy.path, "\n\nChanged source.");
    await assert.rejects(app.render(copy.path, { trustedMdx: true }), error => {
      diagnostic("PLANLOFT_MDX_SNAPSHOT_STALE")(error);
      assert.ok(error instanceof PlanloftApplicationError);
      assert.match(error.message, /bundle\.js/);
      return true;
    });
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("invalid MDX preserves durable source and snapshot, and publish renders a valid candidate once", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "planloft-publish-validation-"));
  const home = path.join(root, "home");
  const file = path.join(root, "doc.mdx");
  const count = path.join(root, "executions");
  let deployments = 0;
  let deployedHtml = "";
  const app = createPlanloftApplication({ cwd: root, planloftHome: home, publicationAdapter: {
    basePath: () => "/",
    deploy: async ({ dist }) => {
      deployments++;
      deployedHtml = fs.readFileSync(path.join(dist, "index.html"), "utf8");
      return { url: "https://example.test/durable", expiresAt: "2040-01-01T00:00:00.000Z" };
    },
  } });
  try {
    fs.writeFileSync(file, "---\nslug: durable\n---\n\n# Good");
    const stored = await app.hoist(file, { trustedMdx: true });
    const before = fs.readFileSync(stored.document.file);
    const bundle = fs.readFileSync(`${stored.document.file}.bundle.js`);
    const index = fs.readFileSync(path.join(home, "index.json"));
    fs.writeFileSync(file, '---\nslug: durable\n---\n\n<DonutChart data={[{name:"a",SECRET_value:-1}]} label="name" value="SECRET_value" />');
    for (const operation of [() => app.hoist(file, { trustedMdx: true }), () => app.publish(file, { trustedMdx: true })]) {
      await assert.rejects(operation(), diagnostic("MDX_COMPONENT_INPUT", "DonutChart"));
      assert.deepEqual(fs.readFileSync(stored.document.file), before);
      assert.deepEqual(fs.readFileSync(`${stored.document.file}.bundle.js`), bundle);
      assert.deepEqual(fs.readFileSync(path.join(home, "index.json")), index);
    }
    assert.equal(deployments, 0);
    fs.writeFileSync(path.join(root, "counter.tsx"), `import fs from "node:fs"; export function Counter() { fs.appendFileSync(${JSON.stringify(count)}, "x"); return <b>published once</b>; }`);
    fs.writeFileSync(file, 'import {Counter} from "./counter.tsx"\n\n# Durable\n\n<Counter />');
    await app.publish(file, { trustedMdx: true });
    assert.equal(fs.readFileSync(count, "utf8"), "x");
    assert.equal(deployments, 1);
    assert.match(deployedHtml, /<b>published once<\/b>/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("legacy stored authoring failures preserve diagnostics through preview and deployment", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "planloft-stored-diagnostics-"));
  const home = path.join(root, "home");
  const app = createPlanloftApplication({ cwd: root, planloftHome: home, openUrl: () => false, publicationAdapter: {
    basePath: () => "/", deploy: async () => { throw new Error("Host must not be reached"); },
  } });
  try {
    const prepared = await withPlanloftHome(home, () => prepareDocument(ingestDocument("# Stored", { format: "mdx", trustedMdx: true }), { projectRoot: root }));
    const stored = withPlanloftHome(home, () => hoistDocument(prepared, { cwd: root }));
    // Old versions could persist a candidate before its first local render.
    for (const [source, code, component] of [
      ["<MissingComponent />", "MDX_COMPONENT", undefined],
      ['<DonutChart data={[{name:"a",SECRET_value:-1}]} label="name" value="SECRET_value" />', "MDX_COMPONENT_INPUT", "DonutChart"],
    ] as const) {
      const snapshot = await withPlanloftHome(home, () => compileMdx(source, { projectRoot: root }));
      fs.writeFileSync(stored.file, source);
      fs.writeFileSync(`${stored.file}.bundle.js`, snapshot);
      await assert.rejects(app.preview(stored.slug), diagnostic(code, component));
      await assert.rejects(app.deploy(stored.slug), diagnostic(code, component));
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("public HTML hoist and app attachment reject invalid ownership before writing", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "planloft-html-boundary-"));
  const home = path.join(root, "home");
  const app = createPlanloftApplication({ cwd: root, planloftHome: home });
  try {
    for (const [html, code] of [
      ['<!doctype html><html><frameset><frame src="a"></frameset></html>', "PLANLOFT_HTML_FRAMESET_UNSUPPORTED"],
      ['<p>hello</p><!-- planloft-render:head:start -->', "PLANLOFT_RENDER_SUPPORT_CONFLICT"],
      ...["script", "style", "title"].map(tag => [`<!doctype html><html><head><${tag}>unfinished`, "PLANLOFT_RENDER_SUPPORT_CONFLICT"] as const),
    ] as const) {
      assert.throws(() => withPlanloftHome(home, () => hoistDocument(ingestDocument(html, { format: "html", trustedHtml: true }), { cwd: root })), error => error instanceof Error && "code" in error && error.code === code);
      assert.equal(fs.existsSync(home), false);
    }
    fs.writeFileSync(path.join(root, "bad.html"), '<p>hello</p><!-- planloft-collaboration:start -->');
    await assert.rejects(app.attach("bad.html", { out: "out.html", documentId: "test", revision: "1", apiUrl: "https://example.test" }), diagnostic("PLANLOFT_COLLABORATION_MARKERS_INVALID"));
    assert.equal(fs.existsSync(path.join(root, "out.html")), false);
    const source = path.join(root, "durable.html");
    fs.writeFileSync(source, "<p>Usable source</p>");
    const stored = await app.hoist(source, { trustedHtml: true, slug: "durable" });
    const before = fs.readFileSync(stored.document.file);
    for (const tag of ["script", "style", "title"]) {
      fs.writeFileSync(source, `<!doctype html><html><head><${tag}>unfinished`);
      await assert.rejects(app.hoist(source, { trustedHtml: true, slug: "durable" }), diagnostic("PLANLOFT_RENDER_SUPPORT_CONFLICT"));
      assert.deepEqual(fs.readFileSync(stored.document.file), before);
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("blocked import maps and package self references cannot reuse a snapshot", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "planloft-resolution-policy-"));
  const app = createPlanloftApplication({ cwd: root, planloftHome: path.join(root, "home") });
  const source = path.join(root, "doc.mdx");
  const manifest = path.join(root, "package.json");
  fs.writeFileSync(path.join(root, "label.tsx"), "export const Label = () => <b>Old snapshot</b>;");
  try {
    for (const specifier of ["#label", "self-package"]) {
      fs.writeFileSync(source, `import {Label} from "${specifier}"\n\n<Label />`);
      const mapping = (target: string | null) => specifier === "#label"
        ? { name: "self-package", imports: { "#label": target } }
        : { name: "self-package", exports: target };
      fs.writeFileSync(manifest, JSON.stringify(mapping("./label.tsx")));
      const snapshot = await compileMdx(fs.readFileSync(source, "utf8"), { sourcePath: source, projectRoot: root });
      fs.writeFileSync(`${source}.bundle.js`, snapshot);
      for (const target of ["INVALID_TARGET", null]) {
        fs.writeFileSync(manifest, JSON.stringify(mapping(target)));
        await assert.rejects(app.render(source, { trustedMdx: true }), diagnostic("MDX_IMPORT"));
      }
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
