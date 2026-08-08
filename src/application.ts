import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  PUBLICATION_PRIVACY_DISCLOSURE,
} from "./command-knowledge.js";
import { loadConfig, ensureConfig, resolveTheme, type ConfigError } from "./core/config.js";
import { docDir, docFile } from "./core/doc.js";
import { resolveGiscusConfig } from "./core/giscus.js";
import { hoistDocument } from "./core/hoist.js";
import { shortId } from "./core/id.js";
import { normalizeDocumentMetadata } from "./core/ingest.js";
import { configPath, withPlanloftHome } from "./core/paths.js";
import { gitRoot, projectKey } from "./core/project.js";
import { slugify } from "./core/slug.js";
import { ensureProject, getDoc, latestDoc, loadIndex, removeDoc, saveIndex } from "./core/store.js";
import { calculateExpiry, resolveTtlDays } from "./core/ttl.js";
import type { Config, DocMeta, Kind, ResolvedContext } from "./core/types.js";
import { getAdapter } from "./hosts/adapter.js";
import { hasGh } from "./hosts/github-pages.js";
import { buildSite, renderDocument } from "./render/renderer.js";
import { readTemplate } from "./render/themes.js";
import {
  readCanonicalDocument,
  type SourceFlags,
  type SourceReader,
} from "./commands/source.js";

export const APPLICATION_ERROR_CATEGORIES = [
  "validation",
  "not_found",
  "conflict",
  "configuration",
  "local_effect",
  "external_effect",
  "internal",
] as const;

export type ApplicationErrorCategory = (typeof APPLICATION_ERROR_CATEGORIES)[number];
export type ApplicationOperation =
  | "render"
  | "hoist"
  | "publish"
  | "resolve"
  | "list"
  | "preview"
  | "copy"
  | "deploy"
  | "remove"
  | "config"
  | "init"
  | "hook";

const ERROR_CODES: Record<ApplicationErrorCategory, string> = {
  validation: "PLANLOFT_APPLICATION_VALIDATION",
  not_found: "PLANLOFT_APPLICATION_NOT_FOUND",
  conflict: "PLANLOFT_APPLICATION_CONFLICT",
  configuration: "PLANLOFT_APPLICATION_CONFIGURATION",
  local_effect: "PLANLOFT_APPLICATION_LOCAL_EFFECT",
  external_effect: "PLANLOFT_APPLICATION_EXTERNAL_EFFECT",
  internal: "PLANLOFT_APPLICATION_INTERNAL",
};

export class PlanloftApplicationError extends Error {
  readonly code: string;

  constructor(
    readonly category: ApplicationErrorCategory,
    readonly operation: ApplicationOperation,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "PlanloftApplicationError";
    this.code = ERROR_CODES[category];
  }
}

export interface ApplicationFileSystem {
  readText(file: string): string;
  readBytes(file: string): Uint8Array;
  writeText(file: string, contents: string): void;
  writeBytes(file: string, contents: Uint8Array): void;
  exists(file: string): boolean;
  makeDirectory(directory: string): void;
  removeFile(file: string): void;
}

export interface ApplicationDependencies {
  cwd?: string | (() => string);
  planloftHome?: string;
  clock?: () => Date;
  fileSystem?: ApplicationFileSystem;
  id?: () => string;
  publicationAdapter?: ApplicationPublicationAdapter;
  openUrl?: (url: string) => boolean;
  editFile?: (editor: string, file: string) => void;
  hasGithubCli?: () => boolean;
  environment?: Readonly<Record<string, string | undefined>>;
}

export interface ApplicationPublicationInput {
  id: string;
  dist: string;
  ttlDays: number;
  now: Date;
  document: { project: string; slug: string; title: string; kind: string };
}

export interface ApplicationPublicationAdapterResult {
  url: string;
  expiresAt: string;
  warnings?: string[];
}

export interface ApplicationPublicationAdapter {
  basePath(id: string): string;
  deploy(input: ApplicationPublicationInput): Promise<ApplicationPublicationAdapterResult>;
}

export interface DocumentSourceOptions extends SourceFlags {}

export interface ApplicationRenderOptions extends DocumentSourceOptions {
  out?: string;
  noindex?: boolean;
}

export interface DeployOptions {
  ttl?: number;
  comments?: boolean;
}

export interface PublishOptions extends DocumentSourceOptions, DeployOptions {}

export interface DocumentSummary {
  slug: string;
  title: string;
  kind: string;
  format: string;
  status?: string;
  theme?: string;
  updatedAt: string;
}

export interface DeploymentSummary {
  url: string;
  expiresAt: string;
  ttlDays: number;
  warnings: string[];
}

export type RenderResult =
  | { operation: "render"; output: "stdout"; html: string }
  | { operation: "render"; output: "file"; path: string };

export interface HoistResult {
  operation: "hoist";
  document: DocumentSummary & { file: string };
}

export interface PublishResult {
  operation: "publish";
  document: DocumentSummary & { file: string };
  deployment: DeploymentSummary;
}

export interface ResolveResult {
  operation: "resolve";
  context: ResolvedContext;
}

export interface ListProjectResult {
  key: string;
  label: string;
  documents: DocumentSummary[];
}

export interface ListResult {
  operation: "list";
  projects: ListProjectResult[];
}

export interface PreviewResult {
  operation: "preview";
  slug: string;
  directory: string;
  url: string;
  opened: boolean;
}

export interface CopyResult {
  operation: "copy";
  slug: string;
  path: string;
  relativePath: string;
  usedCurrentDirectory: boolean;
  replaced: boolean;
}

export interface DeployResult {
  operation: "deploy";
  slug: string;
  deployment: DeploymentSummary;
}

export interface RemoveResult {
  operation: "remove";
  slug: string;
  sourceRemoved: boolean;
}

export interface RedactedConfiguration {
  version: 1;
  theme: string;
  defaultTtlDays: number;
  projects: Record<
    string,
    {
      theme?: string;
      giscus?: Partial<GiscusCoordinates>;
    }
  >;
  giscus?: Partial<GiscusCoordinates>;
  github?: { token?: "[redacted]"; user?: string; repo?: string };
  vercel?: { token?: "[redacted]" };
}

interface GiscusCoordinates {
  repo: string;
  repoId: string;
  category: string;
  categoryId: string;
}

export type ConfigResult =
  | { operation: "config"; mode: "edited"; path: string }
  | { operation: "config"; mode: "printed"; path: string; config: RedactedConfiguration };

export interface InitResult {
  operation: "init";
  configPath: string;
  configCreated: boolean;
  theme: string;
  captureFormat: "md";
  defaultTtlDays: number;
  github: { ready: boolean; repo: string };
}

export interface PlanloftApplication {
  render(input: string, options?: ApplicationRenderOptions): Promise<RenderResult>;
  hoist(input: string, options?: DocumentSourceOptions): Promise<HoistResult>;
  publish(input: string, options?: PublishOptions): Promise<PublishResult>;
  resolve(options?: { slug?: string; title?: string; kind?: string }): Promise<ResolveResult>;
  list(options?: { kind?: string }): Promise<ListResult>;
  preview(slug?: string): Promise<PreviewResult>;
  copy(slug?: string, options?: { force?: boolean }): Promise<CopyResult>;
  deploy(slug?: string, options?: DeployOptions): Promise<DeployResult>;
  remove(slug: string): Promise<RemoveResult>;
  config(): Promise<ConfigResult>;
  init(): Promise<InitResult>;
}

const nativeFileSystem: ApplicationFileSystem = {
  readText: (file) => fs.readFileSync(file, "utf8"),
  readBytes: (file) => fs.readFileSync(file),
  writeText: (file, contents) => fs.writeFileSync(file, contents),
  writeBytes: (file, contents) => fs.writeFileSync(file, contents),
  exists: (file) => {
    try {
      fs.lstatSync(file);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
  },
  makeDirectory: (directory) => fs.mkdirSync(directory, { recursive: true }),
  removeFile: (file) => fs.rmSync(file),
};

export function createPlanloftApplication(
  dependencies: ApplicationDependencies = {},
): PlanloftApplication {
  const fileSystem = dependencies.fileSystem ?? nativeFileSystem;
  const sourceReader: SourceReader = fileSystem;
  const clock = dependencies.clock ?? (() => new Date());
  const makeId = dependencies.id ?? shortId;
  const host = getAdapter("github")!;
  const environment = dependencies.environment ?? process.env;
  const currentDirectory = () =>
    path.resolve(typeof dependencies.cwd === "function" ? dependencies.cwd() : dependencies.cwd ?? process.cwd());

  const run = <T>(operation: ApplicationOperation, effect: () => Promise<T> | T): Promise<T> =>
    withPlanloftHome(dependencies.planloftHome, async () => {
      try {
        return await effect();
      } catch (error) {
        throw classifyError(operation, error);
      }
    });

  const deployMeta = async (
    meta: DocMeta,
    options: DeployOptions,
    prepared?: { cfg: Config; theme: string; ttlDays: number; now: Date },
  ): Promise<DeploymentSummary> => {
    const cwd = currentDirectory();
    const key = projectKey(cwd).key;
    const cfg = prepared?.cfg ?? loadConfig();
    const theme = prepared?.theme ?? resolveTheme(cfg, key, meta.theme);
    const ttlDays = prepared?.ttlDays ?? resolveTtlDays(options.ttl, cfg.defaultTtlDays);
    const now = prepared?.now ?? clock();
    calculateExpiry(ttlDays, now, options.ttl === undefined ? "config.defaultTtlDays" : "--ttl");
    const comments = options.comments ? resolveGiscusConfig(cfg, key) : undefined;
    const id = makeId();
    const base = dependencies.publicationAdapter?.basePath(id) ?? host.basePath(id);
    const dist = buildSite({ doc: meta, theme, base, comments, noindex: true });
    let result;
    try {
      result = dependencies.publicationAdapter
        ? await dependencies.publicationAdapter.deploy({
            id,
            dist,
            ttlDays,
            now,
            document: {
              project: meta.project,
              slug: meta.slug,
              title: meta.title,
              kind: meta.kind,
            },
          })
        : await host.deploy({ id, dist, doc: meta, ttlDays, cfg, now });
    } catch (error) {
      throw applicationError("external_effect", "deploy", error);
    }
    return {
      url: result.url,
      expiresAt: result.expiresAt,
      ttlDays,
      warnings: [...(result.warnings ?? []), PUBLICATION_PRIVACY_DISCLOSURE],
    };
  };

  return {
    render: (input, options = {}) =>
      run("render", async () => {
        const doc = await readCanonicalDocument(input, options, sourceReader);
        const cwd = currentDirectory();
        const { key } = projectKey(cwd);
        const theme = doc.theme ?? resolveTheme(loadConfig(), key);
        const html = renderDocument(doc, theme, { noindex: options.noindex });
        if (!options.out) return { operation: "render", output: "stdout", html };

        const destination = outputFile(options.out);
        fileSystem.makeDirectory(path.dirname(destination));
        fileSystem.writeText(destination, html);
        return { operation: "render", output: "file", path: path.resolve(destination) };
      }),

    hoist: (input, options = {}) =>
      run("hoist", async () => {
        const doc = await readCanonicalDocument(input, options, sourceReader);
        const cwd = currentDirectory();
        const key = projectKey(cwd).key;
        resolveTheme(loadConfig(), key, doc.theme);
        const meta = hoistDocument(doc, { cwd, now: clock() });
        return { operation: "hoist", document: publicDocument(meta, true) };
      }),

    publish: (input, options = {}) =>
      run("publish", async () => {
        // Parse and validate every locally knowable input before the first store write.
        const doc = await readCanonicalDocument(input, options, sourceReader);
        const cwd = currentDirectory();
        const { key } = projectKey(cwd);
        const cfg = loadConfig();
        const theme = resolveTheme(cfg, key, doc.theme);
        const ttlDays = resolveTtlDays(options.ttl, cfg.defaultTtlDays);
        const now = clock();
        calculateExpiry(ttlDays, now, options.ttl === undefined ? "config.defaultTtlDays" : "--ttl");
        if (options.comments) resolveGiscusConfig(cfg, key);

        const meta = hoistDocument(doc, { cwd, now });
        const deployment = await deployMeta(meta, options, { cfg, theme, ttlDays, now });
        return { operation: "publish", document: publicDocument(meta, true), deployment };
      }),

    resolve: (options = {}) =>
      run("resolve", () => {
        const metadata = normalizeDocumentMetadata(options, "resolve options");
        const cwd = currentDirectory();
        const { key, label } = projectKey(cwd);
        const kind: Kind = metadata.kind ?? "plan";
        const title = metadata.title ?? metadata.slug ?? capitalize(kind);
        const slug = slugify(metadata.slug ?? title);
        const theme = resolveTheme(loadConfig(), key);
        const format = "md" as const;

        // Defaults are persisted only after metadata/configuration/theme validation.
        ensureConfig();
        const index = loadIndex();
        ensureProject(index, key, label);
        saveIndex(index);
        fileSystem.makeDirectory(docDir(label));
        const context: ResolvedContext = {
          path: docFile(label, slug, format),
          kind,
          format,
          theme,
          template: readTemplate(theme),
        };
        return { operation: "resolve", context };
      }),

    list: (options = {}) =>
      run("list", () => {
        const projects = Object.values(loadIndex().projects)
          .map((project) => ({
            key: project.key,
            label: project.label,
            documents: Object.values(project.docs)
              .filter((doc) => options.kind === undefined || doc.kind === options.kind)
              .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
              .map((doc) => publicDocument(doc, false)),
          }))
          .filter((project) => project.documents.length > 0);
        return { operation: "list", projects };
      }),

    preview: (slug) =>
      run("preview", () => {
        const cwd = currentDirectory();
        const { key } = projectKey(cwd);
        const meta = slug ? getDoc(key, slug) : latestDoc(key);
        if (!meta) throw applicationError("not_found", "preview", "No matching doc to preview.");
        const cfg = loadConfig();
        const theme = resolveTheme(cfg, key, meta.theme);
        const directory = buildSite({ doc: meta, theme, base: "/" });
        const url = `file://${directory}/index.html`;
        const opened = (dependencies.openUrl ?? openUrl)(url);
        return { operation: "preview", slug: meta.slug, directory, url, opened };
      }),

    copy: (slug, options = {}) =>
      run("copy", () => {
        const cwd = currentDirectory();
        const { key } = projectKey(cwd);
        const meta = slug ? getDoc(key, slug) : latestDoc(key);
        if (!meta) {
          throw applicationError("not_found", "copy", "No matching doc in the store for this project.");
        }
        const root = gitRoot(cwd);
        const destination = path.join(root ?? cwd, ".planloft", "plans", path.basename(meta.file));
        const replaced = fileSystem.exists(destination);
        if (replaced && !options.force) {
          throw applicationError(
            "conflict",
            "copy",
            `Refusing to overwrite ${destination}. Re-run with --force to replace it.`,
          );
        }

        const contents = fileSystem.readBytes(meta.file);
        fileSystem.makeDirectory(path.dirname(destination));
        fileSystem.writeBytes(destination, contents);
        return {
          operation: "copy",
          slug: meta.slug,
          path: destination,
          relativePath: path.relative(root ?? cwd, destination),
          usedCurrentDirectory: root === null,
          replaced,
        };
      }),

    deploy: (slug, options = {}) =>
      run("deploy", async () => {
        const cwd = currentDirectory();
        const { key } = projectKey(cwd);
        const meta = slug ? getDoc(key, slug) : latestDoc(key);
        if (!meta) throw applicationError("not_found", "deploy", "No matching doc to deploy.");
        const deployment = await deployMeta(meta, options);
        return { operation: "deploy", slug: meta.slug, deployment };
      }),

    remove: (slug) =>
      run("remove", () => {
        if (typeof slug !== "string" || slug.trim() === "") {
          throw applicationError("validation", "remove", "Document slug must be a nonblank string.");
        }
        const { key } = projectKey(currentDirectory());
        const meta = getDoc(key, slug);
        if (!meta) {
          throw applicationError("not_found", "remove", `No doc '${slug}' for this project.`);
        }
        removeDoc(key, slug);
        let sourceRemoved = false;
        try {
          fileSystem.removeFile(meta.file);
          sourceRemoved = true;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
        return { operation: "remove", slug, sourceRemoved };
      }),

    config: () =>
      run("config", () => {
        ensureConfig();
        const file = configPath();
        const editor = environment.EDITOR || environment.VISUAL;
        if (editor) {
          (dependencies.editFile ?? editFile)(editor, file);
          loadConfig();
          return { operation: "config", mode: "edited", path: file };
        }
        return { operation: "config", mode: "printed", path: file, config: redactConfig(loadConfig()) };
      }),

    init: () =>
      run("init", () => {
        const file = configPath();
        const configCreated = !fileSystem.exists(file);
        const cfg = configCreated ? ensureConfig() : loadConfig();
        return {
          operation: "init",
          configPath: file,
          configCreated,
          theme: cfg.theme,
          captureFormat: "md",
          defaultTtlDays: cfg.defaultTtlDays,
          github: {
            ready: (dependencies.hasGithubCli ?? hasGh)(),
            repo: cfg.github?.repo ?? "planloft-plans",
          },
        };
      }),

  };
}

export function redactConfig(config: Config): RedactedConfiguration {
  const { github: _github, vercel: _vercel, ...visibleConfig } = config;
  const github = config.github
    ? (({ token: _token, ...visible }) => ({
        ...visible,
        ...(config.github?.token === undefined ? {} : { token: "[redacted]" as const }),
      }))(config.github)
    : undefined;
  const vercel = config.vercel
    ? { ...(config.vercel.token === undefined ? {} : { token: "[redacted]" as const }) }
    : undefined;
  return {
    ...visibleConfig,
    ...(github ? { github } : {}),
    ...(vercel ? { vercel } : {}),
  };
}

function publicDocument(meta: DocMeta, includeFile: true): DocumentSummary & { file: string };
function publicDocument(meta: DocMeta, includeFile: false): DocumentSummary;
function publicDocument(meta: DocMeta, includeFile: boolean): DocumentSummary & { file?: string } {
  return {
    slug: meta.slug,
    title: meta.title,
    kind: meta.kind,
    format: meta.format,
    ...(meta.status === undefined ? {} : { status: meta.status }),
    ...(meta.theme === undefined ? {} : { theme: meta.theme }),
    updatedAt: meta.updatedAt,
    ...(includeFile ? { file: meta.file } : {}),
  };
}

function outputFile(output: string): string {
  return path.extname(output).toLowerCase() === ".html" ? output : path.join(output, "index.html");
}

function openUrl(url: string): boolean {
  const command =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  try {
    execFileSync(command, [url], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function editFile(editor: string, file: string): void {
  execFileSync(editor, [file], { stdio: "inherit" });
}

function classifyError(
  operation: ApplicationOperation,
  error: unknown,
): PlanloftApplicationError {
  if (error instanceof PlanloftApplicationError) {
    return error.operation === operation
      ? error
      : new PlanloftApplicationError(error.category, operation, error.message, { cause: error });
  }
  if (isConfigError(error)) return applicationError("configuration", operation, error);
  if (isValidationError(error)) return applicationError("validation", operation, error);
  return applicationError("local_effect", operation, error);
}

function applicationError(
  category: ApplicationErrorCategory,
  operation: ApplicationOperation,
  error: unknown,
): PlanloftApplicationError {
  const message = typeof error === "string" ? error : error instanceof Error ? error.message : String(error);
  return new PlanloftApplicationError(category, operation, message, {
    ...(error instanceof Error ? { cause: error } : {}),
  });
}

function isConfigError(error: unknown): error is ConfigError {
  return error instanceof Error && error.name === "ConfigError";
}

function isValidationError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /(?:must|required|invalid|unsupported|cannot infer|disabled by default|unknown .* field|TTL|expiry|metadata|PLANLOFT_THEME)/i.test(
    error.message,
  );
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
