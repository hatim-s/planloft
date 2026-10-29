import fs from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { builtinModules, createRequire } from "node:module";
import { compile } from "@mdx-js/mdx";
import remarkGfm from "remark-gfm";
import { build, type Plugin } from "esbuild";
import { packageRoot, planloftHome } from "../core/paths.js";
import type { CanonicalDocument } from "../core/types.js";
import * as frontmatter from "../core/frontmatter.js";
import { gitRoot } from "../core/project.js";
import { isBuiltinComponentName, isComponentInputReason } from "../components/metadata.js";
import type { BuiltinComponentName, ComponentInputReason } from "../components/metadata.js";

export interface MdxCompileOptions {
  /** Absolute source location used to resolve relative imports. */
  sourcePath?: string;
  /** Project root containing .planloft/components/index.tsx, if any. */
  projectRoot?: string;
  /** Number of frontmatter lines removed before compilation; null means unavailable. */
  sourceLineOffset?: number | null;
}

interface MdxDiagnosticDetails {
  line?: number;
  column?: number;
  sourceFile?: string;
  imported?: boolean;
  component?: BuiltinComponentName;
  reason?: ComponentInputReason;
}

export class MdxAuthoringError extends Error implements MdxDiagnosticDetails {
  readonly line?: number;
  readonly column?: number;
  readonly sourceFile?: string;
  readonly imported: boolean;
  readonly component?: BuiltinComponentName;
  readonly reason?: ComponentInputReason;

  constructor(readonly code: "MDX_SYNTAX" | "MDX_IMPORT" | "MDX_COMPONENT" | "MDX_COMPONENT_INPUT", details: MdxDiagnosticDetails = {}) {
    const { line, column, sourceFile, imported = false, component, reason } = details;
    const location = line === undefined ? "" : ` at line ${line}${column === undefined ? "" : `, column ${column}`}`;
    const context = imported ? sourceFile ? ` in imported MDX ${sourceFile}` : " in an imported MDX file" : "";
    const message = code === "MDX_SYNTAX" ? `MDX syntax error${context}${location}. Check the document and imported MDX.`
      : code === "MDX_IMPORT" ? "An MDX import could not be resolved. Check the import and its source location."
      : code === "MDX_COMPONENT_INPUT" ? `Invalid data or props for <${component}>. Check the component inputs.`
      : "An MDX component is missing. Import it or add it to a component registry.";
    super(message);
    this.name = "MdxAuthoringError";
    this.line = line;
    this.column = column;
    this.sourceFile = sourceFile;
    this.imported = imported;
    this.component = component;
    this.reason = reason;
  }
}
const authoringErrors = new WeakSet<MdxAuthoringError>();
const unavailableImports = new WeakSet<MdxAuthoringError>();
class ImportDiagnostic extends Error {
  constructor(readonly unavailable: boolean) { super("MDX import failed."); }
}
function authoringError(code: MdxAuthoringError["code"], details: MdxDiagnosticDetails = {}): MdxAuthoringError {
  const error = new MdxAuthoringError(code, details);
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
    return String(await compile(source, { jsx: true, development: false, remarkPlugins: [remarkGfm], providerImportSource: "planloft:components" }));
  } catch (error) {
    const reason = error && typeof error === "object" && "reason" in error && typeof error.reason === "string" ? error.reason : "";
    const location = reason.match(/\((\d{1,7}):(\d{1,7})(?:[-)])/);
    const position = error && typeof error === "object" ? error : {};
    const line = location ? Number(location[1]) : "line" in position && typeof position.line === "number" && Number.isSafeInteger(position.line) && position.line > 0 && position.line <= 9999999 ? position.line : undefined;
    const column = location ? Number(location[2]) : "column" in position && typeof position.column === "number" && Number.isSafeInteger(position.column) && position.column > 0 && position.column <= 9999999 ? position.column : undefined;
    const mappedLine = options.offset === null || line === undefined ? undefined : line + options.offset;
    throw authoringError("MDX_SYNTAX", { line: mappedLine, column: mappedLine === undefined ? undefined : column, sourceFile: options.sourceFile, imported: options.imported });
  }
}

/** Compile trusted MDX and its imports into a self-contained ESM module. */
export async function compileMdx(source: string, options: MdxCompileOptions = {}): Promise<string> {
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
  const userModules = new Set(registries);
  const resolveRuntime = createRequire(path.join(packageRoot, "package.json"));
  const mdxPlugin: Plugin = {
    name: "planloft-mdx",
    setup(builder) {
      builder.onResolve({ filter: /^react(?:\/(?:jsx-runtime|jsx-dev-runtime))?$/ }, args => ({ path: resolveRuntime.resolve(args.path) }));
      builder.onResolve({ filter: /^planloft:components$/ }, () => ({ path: "components", namespace: "provider" }));
      builder.onLoad({ filter: /.*/, namespace: "provider" }, () => ({
        contents: `import {builtinComponents} from ${JSON.stringify(componentEntry)};
${imports}
const components = {...builtinComponents, ${registryValues}};
export function useMDXComponents() { return components; }`,
        loader: "tsx", resolveDir: packageRoot,
      }));
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
      builder.onResolve({ filter: /.*/ }, async args => {
        if (args.pluginData === "planloft-resolving" || args.path.startsWith("node:") || builtinModules.includes(args.path)) return;
        if (args.namespace !== "document" && !userModules.has(args.importer) && !userModules.has(args.path)) return;
        const resolved = await builder.resolve(args.path, { resolveDir: args.resolveDir, kind: args.kind, pluginData: "planloft-resolving" });
        if (!resolved.errors.length) {
          if (!resolved.external) userModules.add(resolved.path);
          return resolved;
        }
        const absent = dependencyUnavailable(args.path, args.resolveDir);
        return { errors: resolved.errors.map(error => ({ ...error, detail: new ImportDiagnostic(absent) })) };
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
      contents: `import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import Document from 'planloft:document';
import {isComponentInputError} from ${JSON.stringify(componentEntry)};
import {componentStyles} from ${JSON.stringify(styleEntry)};
export {componentStyles};
export function render() { try { return renderToStaticMarkup(React.createElement(Document)); } catch (error) { if (isComponentInputError(error)) return {invalidComponent: error.component, reason: error.reason}; throw error; } }`,
      resolveDir: packageRoot,
      sourcefile: "planloft-entry.tsx",
      loader: "tsx",
    },
    plugins: [mdxPlugin],
    bundle: true,
    minify: true,
    write: false,
    platform: "node",
    jsx: "automatic",
    banner: { js: `import { createRequire as __planloftMdxRequire } from "node:module"; const require = __planloftMdxRequire(process.cwd() + "/package.json");` },
    format: "esm",
    target: "node22",
    nodePaths: [path.join(packageRoot, "node_modules")],
    logLevel: "silent",
    });
  } catch (error) {
    if (error && typeof error === "object" && "errors" in error && Array.isArray(error.errors)) {
      const authored = error.errors.find(entry => isMdxAuthoringError(entry.detail));
      if (authored) throw authored.detail;
      for (const entry of error.errors) {
        if (entry.detail instanceof ImportDiagnostic) {
          const diagnostic = authoringError("MDX_IMPORT");
          if (error.errors.every(entry => entry.detail instanceof ImportDiagnostic && entry.detail.unavailable)) unavailableImports.add(diagnostic);
          throw diagnostic;
        }
      }
    }
    throw error;
  }
  return `// planloft-mdx-sha256:${sourceHash(source)}\n${result.outputFiles[0]!.text}`;
}

export interface RenderedMdxBody { body: string; styles: string }

/** MDX readiness carries its validated body so publication executes the candidate once. */
export type PreparedDocument = CanonicalDocument & (
  | { contentFormat: "mdx"; compiledMdx: string; mdxBody: RenderedMdxBody }
  | { contentFormat: "md" | "html" }
);

export async function prepareDocument(doc: CanonicalDocument, options: MdxCompileOptions = {}): Promise<PreparedDocument> {
  if (doc.contentFormat !== "mdx") return { ...doc, contentFormat: doc.contentFormat };
  const compiledMdx = await prepareMdx(doc.content, { ...options, sourceLineOffset: doc.sourceLineOffset });
  const mdxBody = await renderMdxBody(doc.content, compiledMdx);
  return { ...doc, contentFormat: "mdx", compiledMdx, mdxBody };
}

export async function renderMdxBody(source: string, code: string): Promise<RenderedMdxBody> {
  assertMdxSnapshot(source, code);
  let styles: string;
  let body: string | { invalidComponent: unknown; reason?: unknown };
  try {
    // The compiler owns these exports; snapshots execute under the source trust contract.
    const module = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`) as { render(): typeof body; componentStyles: string };
    styles = module.componentStyles;
    body = module.render();
  } catch (error) {
    if (isMissingComponentFailure(error)) throw authoringError("MDX_COMPONENT");
    // Trusted code can import the public error constructors. Only the compiler may
    // create authenticated diagnostics, so arbitrary render exceptions stop here.
    throw new Error("MDX execution failed.");
  }
  if (typeof body !== "string") {
    if (isBuiltinComponentName(body.invalidComponent)) throw authoringError("MDX_COMPONENT_INPUT", { component: body.invalidComponent, reason: isComponentInputReason(body.reason) ? body.reason : undefined });
    throw new Error("Invalid compiled MDX render result.");
  }
  return { body, styles };
}

function isMissingComponentFailure(error: unknown): boolean {
  // Authored exceptions can have throwing accessors or proxy traps.
  try {
    if (typeof error !== "object" || error === null) return false;
    const message = Object.getOwnPropertyDescriptor(error, "message");
    return !!message && "value" in message && typeof message.value === "string" && /^Expected (?:component|object) `[A-Za-z][A-Za-z0-9_.]{0,79}` to be defined: you likely forgot to import, pass, or provide it\.$/.test(message.value);
  } catch { return false; }
}

function sourceHash(source: string): string {
  return createHash("sha256").update(source).digest("hex");
}

export function assertMdxSnapshot(source: string, code: string): void {
  if (!code.startsWith(`// planloft-mdx-sha256:${sourceHash(normalizeMdxSource(source))}\n`)) {
    throw new MdxSnapshotError();
  }
}

export class MdxSnapshotError extends Error {
  readonly code = "PLANLOFT_MDX_SNAPSHOT_STALE";
  constructor() {
    super("MDX snapshot source does not match. Restore the source dependencies and compile again; the adjacent <source>.bundle.js cannot be reused.");
    this.name = "MdxSnapshotError";
  }
}

/** Source paths compile fresh. A matching snapshot only rescues unavailable imports. */
export async function prepareMdx(source: string, options: MdxCompileOptions = {}): Promise<string> {
  try { return await compileMdx(source, options); } catch (error) {
    const bundle = options.sourcePath && `${options.sourcePath}.bundle.js`;
    if (!isMdxAuthoringError(error) || error.code !== "MDX_IMPORT" || !unavailableImports.has(error) || !bundle || !fs.existsSync(bundle)) throw error;
    const code = fs.readFileSync(bundle, "utf8");
    assertMdxSnapshot(source, code);
    return code;
  }
}

function safeRelativeFile(root: string, file: string): string | undefined {
  const relative = path.relative(fs.realpathSync(root), fs.realpathSync(file)).split(path.sep).join("/");
  if (!relative || relative.length > 160 || relative.startsWith("../") || !/^[A-Za-z0-9._/-]+$/.test(relative)) return undefined;
  return relative;
}

function dependencyUnavailable(specifier: string, directory: string): boolean {
  if (specifier.startsWith(".") || path.isAbsolute(specifier)) {
    const file = path.resolve(directory, specifier);
    return ["", ".tsx", ".ts", ".jsx", ".js", ".mdx", ".json"].every(extension => pathAbsent(file + extension));
  }
  const parts = specifier.split("/");
  const packageName = specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]!;
  // Import maps and protocol specifiers are not absent node_modules packages.
  if (!/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(packageName)) return false;
  for (let current = directory; ; current = path.dirname(current)) {
    const manifest = path.join(current, "package.json");
    if (!pathAbsent(manifest)) {
      try {
        const metadata: unknown = JSON.parse(fs.readFileSync(manifest, "utf8"));
        if (typeof metadata === "object" && metadata !== null && "name" in metadata && metadata.name === packageName) return false;
      } catch { return false; }
    }
    if (!pathAbsent(path.join(current, "node_modules", packageName))) return false;
    if (path.dirname(current) === current) break;
  }
  return pathAbsent(path.join(packageRoot, "node_modules", packageName));
}

function pathAbsent(file: string): boolean {
  try { fs.lstatSync(file); return false; } catch (error) {
    return error instanceof Error && "code" in error && (error.code === "ENOENT" || error.code === "ENOTDIR");
  }
}
