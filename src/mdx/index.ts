import fs from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { createRequire } from "node:module";
import { compile } from "@mdx-js/mdx";
import remarkGfm from "remark-gfm";
import { build, type Plugin } from "esbuild";
import { packageRoot, planloftHome } from "../core/paths.js";
import type { CanonicalDocument } from "../core/types.js";
import * as frontmatter from "../core/frontmatter.js";
import { gitRoot } from "../core/project.js";
import { renderDocument, type RenderOptions } from "../render/renderer.js";

export interface MdxRenderOptions extends RenderOptions {
  /** Absolute source location used to resolve relative imports. */
  sourcePath?: string;
  /** Project root containing .planloft/components/index.tsx, if any. */
  projectRoot?: string;
  /** Number of frontmatter lines removed before compilation; null means unavailable. */
  sourceLineOffset?: number | null;
}

export class MdxAuthoringError extends Error {
  constructor(readonly code: "MDX_SYNTAX" | "MDX_IMPORT" | "MDX_COMPONENT" | "MDX_COMPONENT_INPUT", readonly line?: number, readonly column?: number, readonly sourceFile?: string, readonly imported = false, readonly component?: string) {
    const location = line === undefined ? "" : ` at line ${line}${column === undefined ? "" : `, column ${column}`}`;
    const context = imported ? sourceFile ? ` in imported MDX ${sourceFile}` : " in an imported MDX file" : "";
    const message = code === "MDX_SYNTAX" ? `MDX syntax error${context}${location}. Check the document and imported MDX.`
      : code === "MDX_IMPORT" ? "An MDX import could not be resolved. Check the import and its source location."
      : code === "MDX_COMPONENT_INPUT" ? `Invalid data or props for <${component}>. Check the component inputs.`
      : "An MDX component is missing. Import it or add it to a component registry.";
    super(message);
    this.name = "MdxAuthoringError";
  }
}
const authoringErrors = new WeakSet<MdxAuthoringError>();
function authoringError(code: MdxAuthoringError["code"], line?: number, column?: number, sourceFile?: string, imported = false, component?: string): MdxAuthoringError {
  const error = new MdxAuthoringError(code, line, column, sourceFile, imported, component);
  authoringErrors.add(error);
  return Object.freeze(error);
}
export function isMdxAuthoringError(error: unknown): error is MdxAuthoringError {
  try { return error instanceof MdxAuthoringError && authoringErrors.has(error); } catch { return false; }
}
export function normalizeMdxSource(source: string): string {
  return frontmatter.parse(frontmatter.stringify(source, {})).content;
}
async function compileSource(source: string, options: { offset: number | null; imported?: boolean; sourceFile?: string }): Promise<string> {
  try {
    return String(await compile(source, { jsx: true, development: false, remarkPlugins: [remarkGfm] }));
  } catch (error) {
    const reason = error && typeof error === "object" && "reason" in error && typeof error.reason === "string" ? error.reason : "";
    const location = reason.match(/\((\d{1,7}):(\d{1,7})(?:[-)])/);
    const position = error && typeof error === "object" ? error : {};
    const line = location ? Number(location[1]) : "line" in position && typeof position.line === "number" && Number.isSafeInteger(position.line) && position.line > 0 && position.line <= 9999999 ? position.line : undefined;
    const column = location ? Number(location[2]) : "column" in position && typeof position.column === "number" && Number.isSafeInteger(position.column) && position.column > 0 && position.column <= 9999999 ? position.column : undefined;
    const mappedLine = options.offset === null || line === undefined ? undefined : line + options.offset;
    throw authoringError("MDX_SYNTAX", mappedLine, mappedLine === undefined ? undefined : column, options.sourceFile, options.imported);
  }
}

/** Compile trusted MDX and its imports into a self-contained ESM module. */
export async function compileMdx(source: string, options: MdxRenderOptions = {}): Promise<string> {
  source = normalizeMdxSource(source);
  const sourcePath = path.resolve(options.sourcePath ?? path.join(options.projectRoot ?? process.cwd(), "document.mdx"));
  const componentEntry = fs.existsSync(path.join(packageRoot, "src/components/index.ts"))
    ? path.join(packageRoot, "src/components/index.ts")
    : path.join(packageRoot, "dist/components/index.js");
  const styleEntry = componentEntry.replace(/index\.(ts|js)$/, "styles.$1");
  const projectRoot = path.resolve(options.projectRoot ?? gitRoot(process.cwd()) ?? process.cwd());
  const registries = [
    path.join(planloftHome(), "components/index.tsx"),
    path.join(projectRoot, ".planloft/components/index.tsx"),
  ].filter(file => fs.existsSync(file));
  const imports = registries.map((file, index) => `import * as registry${index} from ${JSON.stringify(file)};`).join("\n");
  const registryValues = registries.map((_, index) => `...registry${index}`).join(", ");
  const resolveRuntime = createRequire(path.join(packageRoot, "package.json"));
  const mdxPlugin: Plugin = {
    name: "planloft-mdx",
    setup(builder) {
      builder.onResolve({ filter: /^react(?:\/(?:jsx-runtime|jsx-dev-runtime))?$/ }, args => ({ path: resolveRuntime.resolve(args.path) }));
      builder.onResolve({ filter: /^planloft:document$/ }, () => ({ path: sourcePath, namespace: "document" }));
      builder.onResolve({ filter: /^planloft\/components$/ }, () => ({ path: componentEntry }));
      builder.onLoad({ filter: /.*/, namespace: "document" }, async () => ({
        contents: await compileSource(source, { offset: options.sourceLineOffset === undefined ? 0 : options.sourceLineOffset }),
        loader: "jsx",
        resolveDir: path.dirname(sourcePath),
      }));
      builder.onLoad({ filter: /\.js$/ }, async args => {
        if (!args.path.startsWith(path.join(packageRoot, "dist") + path.sep)) return;
        const contents = await fs.promises.readFile(args.path, "utf8");
        const banner = "import { createRequire as __planloftCreateRequire } from 'node:module'; const require = __planloftCreateRequire(import.meta.url);\n";
        return { contents: contents.startsWith(banner) ? contents.slice(banner.length) : contents, loader: "js", resolveDir: path.dirname(args.path) };
      });
      builder.onLoad({ filter: /\.mdx$/ }, async args => ({
        contents: await compileSource(await fs.promises.readFile(args.path, "utf8"), { offset: 0, imported: true, sourceFile: safeRelativeFile(projectRoot, args.path) }),
        loader: "jsx",
        resolveDir: path.dirname(args.path),
      }));
    },
  };
  let result;
  try {
    result = await build({
    stdin: {
      contents: `import React from 'react';\nimport {renderToStaticMarkup} from 'react-dom/server';\nimport Document from 'planloft:document';\nimport {builtinComponents, ComponentInputError} from ${JSON.stringify(componentEntry)};\nimport {componentStyles} from ${JSON.stringify(styleEntry)};\nexport {componentStyles};\n${imports}\nexport function render() { try { return renderToStaticMarkup(React.createElement(Document, {components: {...builtinComponents, ${registryValues}}})); } catch (error) { if (error instanceof ComponentInputError) { const match = /^<([A-Za-z]+)>/.exec(error.message); if (match && Object.hasOwn(builtinComponents, match[1])) return {invalidComponent: match[1]}; } throw error; } }`,
      resolveDir: packageRoot,
      sourcefile: "planloft-entry.tsx",
      loader: "tsx",
    },
    plugins: [mdxPlugin],
    bundle: true,
    write: false,
    platform: "node",
    jsx: "automatic",
    banner: { js: `import { createRequire as __planloftMdxRequire } from "node:module"; const require = __planloftMdxRequire(process.cwd() + "/package.json");` },
    format: "esm",
    target: "node18",
    nodePaths: [path.join(packageRoot, "node_modules")],
    logLevel: "silent",
    });
  } catch (error) {
    if (error && typeof error === "object" && "errors" in error && Array.isArray(error.errors)) {
      for (const entry of error.errors) {
        if (isMdxAuthoringError(entry.detail)) throw entry.detail;
        if (typeof entry.text === "string" && entry.text.startsWith("Could not resolve ")) throw authoringError("MDX_IMPORT");
      }
    }
    throw error;
  }
  return `// planloft-mdx-sha256:${sourceHash(source)}\n${result.outputFiles[0]!.text}`;
}

/** Render only code the caller trusts. MDX expressions and imports execute on the server. */
export async function renderMdxDocument(doc: CanonicalDocument, theme: string, options: MdxRenderOptions = {}): Promise<string> {
  if (doc.contentFormat !== "mdx") throw new Error("renderMdxDocument requires an MDX document.");
  const code = await prepareMdx(doc.content, { ...options, sourceLineOffset: doc.sourceLineOffset });
  return renderCompiledMdx(doc, theme, code, options);
}

export async function renderCompiledMdx(doc: CanonicalDocument, theme: string, code: string, options: RenderOptions = {}): Promise<string> {
  assertMdxSnapshot(doc.content, code);
  const module = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`) as { render(): string | { invalidComponent: string }; componentStyles: string };
  let body: string | { invalidComponent: string };
  try { body = module.render(); } catch (error) {
    if (error instanceof Error && /^Expected (?:component|object) `[A-Za-z][A-Za-z0-9_.]{0,79}` to be defined: you likely forgot to import, pass, or provide it\.$/.test(error.message)) throw authoringError("MDX_COMPONENT");
    throw error;
  }
  if (typeof body !== "string") {
    const allowed = new Set(["Badge", "BarChart", "Callout", "Checklist", "DataTable", "DonutChart", "Heatmap", "LineChart", "Milestone", "Sparkline", "Stat", "Stats", "Status", "Timeline", "Todo", "WaterfallChart"]);
    if (allowed.has(body.invalidComponent)) throw authoringError("MDX_COMPONENT_INPUT", undefined, undefined, undefined, false, body.invalidComponent);
    throw new Error("Invalid compiled MDX render result.");
  }
  return renderDocument(doc, theme, { ...options, bodyHtml: body, extraStyles: module.componentStyles });
}

function sourceHash(source: string): string {
  return createHash("sha256").update(source).digest("hex");
}

export function assertMdxSnapshot(source: string, code: string): void {
  if (!code.startsWith(`// planloft-mdx-sha256:${sourceHash(normalizeMdxSource(source))}\n`)) {
    throw new Error("Stored MDX has changed since its dependencies were compiled. Hoist it again from its source location.");
  }
}

/** Reuse an adjacent snapshot when a source has been copied away from its imports. */
export async function prepareMdx(source: string, options: MdxRenderOptions = {}): Promise<string> {
  const bundle = options.sourcePath && `${options.sourcePath}.bundle.js`;
  if (bundle && fs.existsSync(bundle)) {
    const code = fs.readFileSync(bundle, "utf8");
    assertMdxSnapshot(source, code);
    return code;
  }
  return compileMdx(source, options);
}

function safeRelativeFile(root: string, file: string): string | undefined {
  const relative = path.relative(fs.realpathSync(root), fs.realpathSync(file)).split(path.sep).join("/");
  if (!relative || relative.length > 160 || relative.startsWith("../") || !/^[A-Za-z0-9._/-]+$/.test(relative)) return undefined;
  return relative;
}
