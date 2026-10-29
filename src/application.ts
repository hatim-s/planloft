import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  createPlanloftConfiguration,
  type ConfigDiagnosticCode,
  type RedactedConfiguration,
} from "./configuration.js";
import { docFile } from "./core/doc.js";
import { shortId } from "./core/id.js";
import { normalizeDocumentMetadata } from "./core/ingest.js";
import { configPath, withPlanloftHome } from "./core/paths.js";
import { projectKey } from "./core/project.js";
import { slugify } from "./core/slug.js";
import type { DocMeta, Kind, ResolvedContext } from "./core/types.js";
import { hasGh } from "./hosts/github-pages.js";
import { attachCollaboration } from "./collaboration/attachment.js";
import { buildCollaborationDeployment } from "./collaboration/deploy.js";
import { packageRoot } from "./core/paths.js";
import type { CollaborationConfig, CollaborationProvider } from "./collaboration/contracts.js";
import { MigrationError, migrateDocument, type MigrationResult } from "./migration/index.js";
import { prepareHostingRepository } from "./hosts/layout.js";
import {
  createDocumentPersistence,
} from "./persistence.js";
import {
  createPublicationModule,
  type ApplicationPublicationAdapter,
  type ApplicationPublicationAdapterResult,
  type ApplicationPublicationInput,
  type PreparedPublication,
  type PublicationEffectStage,
  type PublicationOptions,
} from "./publication.js";
import { buildGallery } from "./gallery/index.js";
import { buildSite, renderPreparedDocument } from "./render/renderer.js";
import { isMdxAuthoringError, type MdxAuthoringError } from "./mdx/compiler.js";
import { isBuiltinComponentName, isComponentInputReason, type BuiltinComponentName, type ComponentInputReason } from "./components/metadata.js";
import { type ThemeDiagnosticCode } from "./render/themes.js";
import {
  readPreparedDocument,
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
  | "migrate-to-vercel"
  | "migrate"
  | "attach"
  | "collaboration-build"
  | "gallery";

const APPLICATION_OPERATIONS = new Set<ApplicationOperation>([
  "render",
  "hoist",
  "publish",
  "resolve",
  "list",
  "preview",
  "copy",
  "deploy",
  "remove",
  "config",
  "init",
  "migrate-to-vercel",
  "migrate",
  "attach",
  "collaboration-build",
  "gallery",
]);

const ERROR_CODES: Record<ApplicationErrorCategory, string> = {
  validation: "PLANLOFT_APPLICATION_VALIDATION",
  not_found: "PLANLOFT_APPLICATION_NOT_FOUND",
  conflict: "PLANLOFT_APPLICATION_CONFLICT",
  configuration: "PLANLOFT_APPLICATION_CONFIGURATION",
  local_effect: "PLANLOFT_APPLICATION_LOCAL_EFFECT",
  external_effect: "PLANLOFT_APPLICATION_EXTERNAL_EFFECT",
  internal: "PLANLOFT_APPLICATION_INTERNAL",
};

export type ApplicationErrorStage = PublicationEffectStage;

export type ApplicationDiagnosticCode =
  | MdxAuthoringError["code"]
  | `PLANLOFT_MIGRATION_${MigrationError["code"]}`
  | "PLANLOFT_COLLABORATION_BUILD_FAILED"
  | "PLANLOFT_COLLABORATION_MARKERS_INVALID"
  | ConfigDiagnosticCode
  | ThemeDiagnosticCode
  | "PLANLOFT_DOCUMENT_METADATA_INVALID"
  | "PLANLOFT_DOCUMENT_INPUT_INVALID"
  | "PLANLOFT_DOCUMENT_FORMAT_INVALID"
  | "PLANLOFT_RESOLVE_FORMAT_INVALID"
  | "PLANLOFT_TRUSTED_HTML_REQUIRED"
  | "PLANLOFT_TRUSTED_MDX_REQUIRED"
  | "PLANLOFT_MDX_SNAPSHOT_STALE"
  | "PLANLOFT_DIRECT_HTML_OPTION_UNSUPPORTED"
  | "PLANLOFT_RENDER_SUPPORT_CONFLICT"
  | "PLANLOFT_HTML_FRAMESET_UNSUPPORTED"
  | "PLANLOFT_TTL_INVALID"
  | "PLANLOFT_EXPIRY_INVALID"
  | "PLANLOFT_GISCUS_CONFIG_INCOMPLETE"
  | "PLANLOFT_GITHUB_AUTH_MISSING"
  | "PLANLOFT_GITHUB_AUTH_INVALID"
  | "PLANLOFT_GITHUB_AUTH_UNREACHABLE"
  | "PLANLOFT_DOCUMENT_NOT_FOUND"
  | "PLANLOFT_VERCEL_CONFIG_INVALID"
  | "PLANLOFT_VERCEL_FAILED"
  | "PLANLOFT_CLOUDFLARE_CONFIG_INVALID"
  | "PLANLOFT_CLOUDFLARE_FAILED"
  | "PLANLOFT_HOST_INVALID"
  | "PLANLOFT_HOSTING_INVALID"
  | "PLANLOFT_COPY_CONFLICT";

export type ApplicationDiagnosticField = "title" | "slug" | "kind" | "theme" | "status";

export interface ApplicationDiagnosticLocation { line: number; column?: number; file?: string }

export interface PlanloftApplicationErrorDetails {
  location?: ApplicationDiagnosticLocation;
  imported?: boolean;
  component?: BuiltinComponentName;
  reason?: ComponentInputReason;
  stage?: ApplicationErrorStage;
  diagnosticCode?: ApplicationDiagnosticCode;
  field?: ApplicationDiagnosticField;
}

export class PlanloftApplicationError extends Error {
  readonly code!: string;
  readonly category!: ApplicationErrorCategory;
  readonly operation!: ApplicationOperation;
  readonly stage?: ApplicationErrorStage;
  readonly diagnosticCode?: ApplicationDiagnosticCode;
  readonly field?: ApplicationDiagnosticField;
  readonly location?: ApplicationDiagnosticLocation;
  readonly imported?: boolean;
  readonly component?: BuiltinComponentName;
  readonly reason?: ComponentInputReason;

  constructor(
    category: ApplicationErrorCategory,
    operation: ApplicationOperation,
    details: PlanloftApplicationErrorDetails = {},
  ) {
    const safeCategory = APPLICATION_ERROR_CATEGORIES.includes(category) ? category : "internal";
    const safeOperation = APPLICATION_OPERATIONS.has(operation) ? operation : "init";
    const safeDetails = sanitizeErrorDetails(details);
    const message = applicationErrorMessage(safeCategory, safeOperation, safeDetails);
    super(message);

    // A public error is a value object, not a carrier for a lower-layer Error. Resetting the
    // prototype prevents a subclass from inserting a hostile toJSON/toString between this
    // object and the frozen public prototype. Defining every public field before freezing also
    // makes construction order explicit for Error's normally mutable message/stack properties.
    Object.setPrototypeOf(this, PlanloftApplicationError.prototype);
    Object.defineProperties(this, {
      name: immutableProperty("PlanloftApplicationError", false),
      message: immutableProperty(message, false),
      stack: immutableProperty(`PlanloftApplicationError: ${message}`, false),
      code: immutableProperty(ERROR_CODES[safeCategory], true),
      category: immutableProperty(safeCategory, true),
      operation: immutableProperty(safeOperation, true),
      stage: immutableProperty(safeDetails.stage, true),
      diagnosticCode: immutableProperty(safeDetails.diagnosticCode, true),
      field: immutableProperty(safeDetails.field, true),
      location: immutableProperty(safeDetails.location, true),
      imported: immutableProperty(safeDetails.imported, true),
      component: immutableProperty(safeDetails.component, true),
      reason: immutableProperty(safeDetails.reason, true),
    });
    Object.freeze(this);
  }

  toJSON(): Readonly<Record<string, unknown>> {
    const output: Record<string, unknown> = {
      name: this.name,
      message: this.message,
      code: this.code,
      category: this.category,
      operation: this.operation,
    };
    if (this.stage !== undefined) output.stage = this.stage;
    if (this.diagnosticCode !== undefined) output.diagnosticCode = this.diagnosticCode;
    if (this.field !== undefined) output.field = this.field;
    if (this.location !== undefined) output.location = this.location;
    if (this.component !== undefined) output.component = this.component;
    if (this.reason !== undefined) output.reason = this.reason;
    if (this.imported !== undefined) output.imported = this.imported;
    return Object.freeze(output);
  }
}

Object.freeze(PlanloftApplicationError.prototype);

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
  promptGithubToken?: () => Promise<string>;
}

export type {
  ApplicationPublicationAdapter,
  ApplicationPublicationAdapterResult,
  ApplicationPublicationInput,
} from "./publication.js";

export interface DocumentSourceOptions extends SourceFlags {}

export interface ApplicationRenderOptions extends DocumentSourceOptions {
  out?: string;
  noindex?: boolean;
}

export interface DeployOptions extends PublicationOptions {}

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

export type { RedactedConfiguration } from "./configuration.js";

export type ConfigResult =
  | { operation: "config"; mode: "edited"; path: string }
  | { operation: "config"; mode: "printed"; path: string; config: RedactedConfiguration };

export interface InitResult {
  operation: "init";
  configPath: string;
  configCreated: boolean;
  configReinitialized: boolean;
  theme: string;
  captureFormat: "md";
  defaultTtlDays: number;
  github: { ready: boolean; repo: string };
}

export interface InitOptions {
  force?: boolean;
}

export interface PlanloftApplication {
  render(input: string, options?: ApplicationRenderOptions): Promise<RenderResult>;
  hoist(input: string, options?: DocumentSourceOptions): Promise<HoistResult>;
  publish(input: string, options?: PublishOptions): Promise<PublishResult>;
  resolve(options?: { slug?: string; title?: string; kind?: string; format?: "md" | "mdx" | "html" }): Promise<ResolveResult>;
  list(options?: { kind?: string }): Promise<ListResult>;
  preview(slug?: string): Promise<PreviewResult>;
  copy(slug?: string, options?: { force?: boolean }): Promise<CopyResult>;
  deploy(slug?: string, options?: DeployOptions): Promise<DeployResult>;
  remove(slug: string): Promise<RemoveResult>;
  config(): Promise<ConfigResult>;
  init(options?: InitOptions): Promise<InitResult>;
  attach(input: string, options: CollaborationConfig & { out: string }): Promise<{ documentId: string }>;
  gallery(options: { out: string }): Promise<{ indexPath: string }>;
  collaborationBuild(options: { provider: CollaborationProvider; out: string }): Promise<{ directory: string }>;
  migrate(source: string, options: { out: string; dryRun?: boolean }): Promise<MigrationResult>;
  migrateToVercel(directory: string): Promise<{ operation: "migrate-to-vercel"; directory: string; migrated: boolean }>;
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
  const environment = dependencies.environment ?? process.env;
  const applicationCwd = path.resolve(
    typeof dependencies.cwd === "function"
      ? dependencies.cwd()
      : dependencies.cwd ?? process.cwd(),
  );
  const currentDirectory = () => applicationCwd;
  const configuration = createPlanloftConfiguration();
  const persistence = createDocumentPersistence({
    cwd: applicationCwd,
    clock,
    fileSystem,
    configuration,
  });
  const publication = createPublicationModule({
    configuration,
    clock,
    id: makeId,
    applicationAdapter: dependencies.publicationAdapter,
    environment,
    auth: { promptToken: dependencies.promptGithubToken },
  });

  const run = <T>(operation: ApplicationOperation, effect: () => Promise<T> | T): Promise<T> =>
    withPlanloftHome(dependencies.planloftHome, async () => {
      try {
        return await effect();
      } catch (error) {
        if (isMdxAuthoringError(error)) throw applicationError("validation", operation, {
          diagnosticCode: error.code,
          component: error.component,
          reason: error.reason,
          ...(error.line === undefined ? {} : { location: { line: error.line, column: error.column, file: error.sourceFile } }),
          imported: error.imported,
        });
        if (operation === "migrate" && error instanceof MigrationError) throw migrationApplicationError(error);
        throw classifyError(operation, error);
      }
    });

  const deployMeta = async (
    meta: DocMeta,
    options: DeployOptions,
    prepared?: PreparedPublication,
    renderedHtml?: string,
  ): Promise<DeploymentSummary> => {
    const validated = prepared ?? publication.prepare(meta, options);
    try {
      return await publication.publish(meta, validated, renderedHtml);
    } catch (error) {
      if (isMdxAuthoringError(error)) throw error;
      throw classifyError("deploy", error);
    }
  };

  return {
    gallery: (options) => run("gallery", () => buildGallery({ outDir: path.resolve(currentDirectory(), options.out) })),
    attach: (input, options) => run("attach", async () => {
      const html = fileSystem.readText(path.resolve(currentDirectory(), input));
      const result = await attachCollaboration(html, { documentId: options.documentId, revision: options.revision, apiUrl: options.apiUrl, contentSelector: options.contentSelector });
      fileSystem.writeText(path.resolve(currentDirectory(), options.out), result.html);
      return { documentId: result.config.documentId };
    }),
    collaborationBuild: (options) => run("collaboration-build", async () => {
      const directory = path.resolve(currentDirectory(), options.out);
      await buildCollaborationDeployment({ provider: options.provider, outDir: directory, projectRoot: packageRoot });
      return { directory };
    }),
    migrate: (source, options) => run("migrate", () => migrateDocument({ sourcePath: path.resolve(currentDirectory(), source), destinationPath: path.resolve(currentDirectory(), options.out), dryRun: options.dryRun })),
    migrateToVercel: (directory) => run("migrate-to-vercel", () => {
      const target = path.resolve(currentDirectory(), directory);
      return { operation: "migrate-to-vercel", directory: target, ...prepareHostingRepository(target) };
    }),
    render: (input, options = {}) =>
      run("render", async () => {
        const cwd = currentDirectory();
        const doc = await readPreparedDocument(input, options, sourceReader, cwd);
        const theme = configuration.resolveProject(projectKey(cwd).key, doc.theme).theme;
        const html = renderPreparedDocument(doc, theme, { noindex: options.noindex });
        if (!options.out) return { operation: "render", output: "stdout", html };

        const destination = outputFile(path.resolve(cwd, options.out));
        fileSystem.makeDirectory(path.dirname(destination));
        fileSystem.writeText(destination, html);
        return { operation: "render", output: "file", path: destination };
      }),

    hoist: (input, options = {}) =>
      run("hoist", async () => {
        const cwd = currentDirectory();
        const doc = await readPreparedDocument(input, options, sourceReader, cwd);
        const meta = persistence.hoist(doc, clock());
        return { operation: "hoist", document: publicDocument(meta, true) };
      }),

    publish: (input, options = {}) =>
      run("publish", async () => {
        // Parse and validate every locally knowable input before the first store write.
        const cwd = currentDirectory();
        const doc = await readPreparedDocument(input, options, sourceReader, cwd);
        const now = clock();
        const project = persistence.project();
        const draftMeta: DocMeta = {
          slug: doc.slug,
          title: doc.title,
          kind: doc.kind,
          project: project.key,
          theme: doc.theme,
          status: doc.status,
          format: doc.contentFormat,
          trustedHtml: doc.trustedHtml,
          file: docFile(project.label, doc.slug, doc.contentFormat),
          updatedAt: now.toISOString(),
        };
        // Publication preparation validates configuration, theme, TTL, expiry, and comments
        // before persistence performs the first mutation.
        const prepared = publication.prepare(draftMeta, options, now);
        const html = renderPreparedDocument(doc, prepared.theme, { noindex: true, comments: prepared.comments });
        const meta = persistence.hoist(doc, now);
        const deployment = await deployMeta(meta, options, prepared, html);
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
        const resolved = configuration.resolveAuthoring(key);
        const theme = resolved.theme;
        const format = options.format ?? "md";
        if (format !== "md" && format !== "mdx" && format !== "html") throw applicationError("validation", "resolve", { diagnosticCode: "PLANLOFT_RESOLVE_FORMAT_INVALID" });

        // Defaults are persisted only after metadata/configuration/theme validation.
        configuration.ensure();
        persistence.ensureProject();
        const context: ResolvedContext = {
          path: docFile(label, slug, format),
          kind,
          format,
          theme,
          themeCss: resolved.themeCss,
          themePath: resolved.themePath,
        };
        return { operation: "resolve", context };
      }),

    list: (options = {}) =>
      run("list", () => {
        const projects = Object.values(persistence.list().projects)
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
      run("preview", async () => {
        const cwd = currentDirectory();
        const meta = persistence.find(slug);
        if (!meta) throw applicationError("not_found", "preview", {
          diagnosticCode: "PLANLOFT_DOCUMENT_NOT_FOUND",
        });
        const theme = configuration.resolveProject(projectKey(cwd).key, meta.theme).theme;
        const directory = await buildSite({ doc: meta, theme });
        const url = `file://${directory}/index.html`;
        const opened = (dependencies.openUrl ?? openUrl)(url);
        return { operation: "preview", slug: meta.slug, directory, url, opened };
      }),

    copy: (slug, options = {}) =>
      run("copy", () => {
        const cwd = currentDirectory();
        let copied;
        try {
          copied = persistence.copy(slug, options);
        } catch (error) {
          if (isNamedDataError(error, "DocumentCopyConflictError")) {
            throw applicationError("conflict", "copy", {
              diagnosticCode: "PLANLOFT_COPY_CONFLICT",
            });
          }
          throw error;
        }
        if (!copied) {
          throw applicationError("not_found", "copy", {
            diagnosticCode: "PLANLOFT_DOCUMENT_NOT_FOUND",
          });
        }
        return {
          operation: "copy",
          slug: copied.document.slug,
          path: copied.path,
          relativePath: copied.relativePath,
          usedCurrentDirectory: copied.usedCurrentDirectory,
          replaced: copied.replaced,
        };
      }),

    deploy: (slug, options = {}) =>
      run("deploy", async () => {
        const cwd = currentDirectory();
        const meta = persistence.find(slug);
        if (!meta) throw applicationError("not_found", "deploy", {
          diagnosticCode: "PLANLOFT_DOCUMENT_NOT_FOUND",
        });
        const deployment = await deployMeta(meta, options);
        return { operation: "deploy", slug: meta.slug, deployment };
      }),

    remove: (slug) =>
      run("remove", () => {
        if (typeof slug !== "string" || slug.trim() === "") {
          throw applicationError("validation", "remove", {
            diagnosticCode: "PLANLOFT_DOCUMENT_METADATA_INVALID",
            field: "slug",
          });
        }
        const removed = persistence.remove(slug);
        if (!removed) {
          throw applicationError("not_found", "remove", {
            diagnosticCode: "PLANLOFT_DOCUMENT_NOT_FOUND",
          });
        }
        return { operation: "remove", slug, sourceRemoved: removed.sourceRemoved };
      }),

    config: () =>
      run("config", () => {
        configuration.ensure();
        const file = configPath();
        const editor = environment.EDITOR || environment.VISUAL;
        if (editor) {
          (dependencies.editFile ?? editFile)(editor, file);
          configuration.load();
          return { operation: "config", mode: "edited", path: file };
        }
        return { operation: "config", mode: "printed", path: file, config: configuration.redact() };
      }),

    init: (options = {}) =>
      run("init", () => {
        const file = configPath();
        const configCreated = !fileSystem.exists(file);
        const configReinitialized = options.force === true && !configCreated;
        const cfg = options.force === true
          ? configuration.reset()
          : configCreated
            ? configuration.ensure()
            : configuration.load();
        return {
          operation: "init",
          configPath: file,
          configCreated,
          configReinitialized,
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
  const inspected = inspectCaughtValue(error);
  if (!inspected.safe) return applicationError("local_effect", operation);
  const candidate = inspected.values;

  if (candidate.name === "PlanloftApplicationError") {
    const category = validCategory(candidate.category);
    const incomingOperation = validOperation(candidate.operation);
    if (category !== undefined && incomingOperation !== undefined) {
      return applicationError(category, operation, {
        stage: validStage(candidate.stage),
        diagnosticCode: validDiagnostic(candidate.diagnosticCode),
        field: validField(candidate.field),
        ...safeAuthoringDetails(candidate),
      });
    }
    return applicationError("local_effect", operation);
  }
  if (candidate.name === "PublicationEffectError") {
    const category = candidate.category === "external_effect" ? "external_effect" :
      candidate.category === "local_effect" ? "local_effect" : undefined;
    const stage = validStage(candidate.stage);
    if (category !== undefined && stage !== undefined) {
      return applicationError(category, operation, {
        stage,
        diagnosticCode: publicationDiagnostic(candidate.message),
      });
    }
    return applicationError("local_effect", operation);
  }
  if (candidate.name === "ConfigError" && validConfigDiagnostic(candidate.code)) {
    return applicationError("configuration", operation, { diagnosticCode: candidate.code });
  }
  if ((candidate.name === "UnsupportedHtmlStructureError" || candidate.name === "CollaborationFramesetError") && candidate.code === "PLANLOFT_HTML_FRAMESET_UNSUPPORTED") {
    return applicationError("validation", operation, { diagnosticCode: "PLANLOFT_HTML_FRAMESET_UNSUPPORTED" });
  }
  if (candidate.name === "RenderSupportError" && candidate.code === "PLANLOFT_RENDER_SUPPORT_CONFLICT") {
    return applicationError("validation", operation, { diagnosticCode: "PLANLOFT_RENDER_SUPPORT_CONFLICT" });
  }
  if (candidate.name === "ThemeError" && validThemeDiagnostic(candidate.code)) {
    return applicationError("validation", operation, { diagnosticCode: candidate.code });
  }
  if (candidate.name === "DocumentTrustError" && (candidate.code === "PLANLOFT_TRUSTED_MDX_REQUIRED" || candidate.code === "PLANLOFT_TRUSTED_HTML_REQUIRED")) return applicationError("validation", operation, { diagnosticCode: candidate.code });
  if (candidate.name === "MdxSnapshotError" && candidate.code === "PLANLOFT_MDX_SNAPSHOT_STALE") return applicationError("validation", operation, { diagnosticCode: candidate.code });
  if (candidate.name === "CollaborationAttachmentError" && candidate.code === "PLANLOFT_COLLABORATION_MARKERS_INVALID") return applicationError("validation", operation, { diagnosticCode: candidate.code });
  if (candidate.name === "CollaborationDeploymentError" && candidate.code === "PLANLOFT_COLLABORATION_BUILD_FAILED") return applicationError("local_effect", operation, { diagnosticCode: candidate.code });
  const hostingCode = typeof candidate.message === "string" ? candidate.message.split(":")[0] : undefined;
  if (hostingCode && validDiagnostic(hostingCode) && ["PLANLOFT_VERCEL_CONFIG_INVALID", "PLANLOFT_CLOUDFLARE_CONFIG_INVALID", "PLANLOFT_HOST_INVALID", "PLANLOFT_HOSTING_INVALID"].includes(hostingCode)) {
    return applicationError("validation", operation, { diagnosticCode: validDiagnostic(hostingCode) });
  }
  const validation = validationDiagnostic(candidate.message);
  if (validation) return applicationError("validation", operation, validation);
  return applicationError("local_effect", operation);
}

/** Rebuild a caught value for the CLI without trusting identity, prototypes, or accessors. */
export function canonicalizePlanloftApplicationError(
  error: unknown,
  operation: ApplicationOperation,
): PlanloftApplicationError {
  const inspected = inspectCaughtValue(error);
  if (!inspected.safe || inspected.values.name !== "PlanloftApplicationError") {
    return applicationError("internal", operation);
  }
  const category = validCategory(inspected.values.category);
  const incomingOperation = validOperation(inspected.values.operation);
  if (category === undefined || incomingOperation === undefined) {
    return applicationError("internal", operation);
  }
  return applicationError(category, operation, {
    stage: validStage(inspected.values.stage),
    diagnosticCode: validDiagnostic(inspected.values.diagnosticCode),
    field: validField(inspected.values.field),
    ...safeAuthoringDetails(inspected.values),
  });
}

function applicationError(
  category: ApplicationErrorCategory,
  operation: ApplicationOperation,
  details: PlanloftApplicationErrorDetails = {},
): PlanloftApplicationError {
  return new PlanloftApplicationError(category, operation, details);
}

function publicationDiagnostic(message: unknown): ApplicationDiagnosticCode | undefined {
  if (typeof message !== "string") return undefined;
  for (const code of [
    "PLANLOFT_HTML_FRAMESET_UNSUPPORTED",
    "PLANLOFT_RENDER_SUPPORT_CONFLICT",
    "PLANLOFT_VERCEL_FAILED",
    "PLANLOFT_CLOUDFLARE_FAILED",
    "PLANLOFT_HOSTING_INVALID",
    "PLANLOFT_GITHUB_AUTH_MISSING",
    "PLANLOFT_GITHUB_AUTH_INVALID",
    "PLANLOFT_GITHUB_AUTH_UNREACHABLE",
  ] as const) {
    if (message.startsWith(`${code}:`)) return code;
  }
  return undefined;
}

function validationDiagnostic(message: unknown): PlanloftApplicationErrorDetails | undefined {
  if (typeof message !== "string") return undefined;
  const metadata = message.match(
    /^(?:resolve options|Markdown frontmatter|JSON document) metadata "(title|slug|kind|theme|status)" must be a nonblank string when provided\.$/,
  );
  if (metadata) {
    return {
      diagnosticCode: "PLANLOFT_DOCUMENT_METADATA_INVALID",
      field: metadata[1] as ApplicationDiagnosticField,
    };
  }
  if (message.startsWith("PLANLOFT_GISCUS_CONFIG_INCOMPLETE:")) {
    return { diagnosticCode: "PLANLOFT_GISCUS_CONFIG_INCOMPLETE" };
  }
  if (/^(?:--ttl|TTL|config\.defaultTtlDays) must be /.test(message)) {
    return { diagnosticCode: "PLANLOFT_TTL_INVALID" };
  }
  if (/^(?:--ttl|TTL|config\.defaultTtlDays) does not produce a representable expiry/.test(message)) {
    return { diagnosticCode: "PLANLOFT_EXPIRY_INVALID" };
  }
  if (message.startsWith("PLANLOFT_DIRECT_HTML_OPTION_UNSUPPORTED:")) {
    return { diagnosticCode: "PLANLOFT_DIRECT_HTML_OPTION_UNSUPPORTED" };
  }
  if (/^(?:Stdin input requires --format|Input format must be|Cannot infer input format from)/.test(message)) {
    return { diagnosticCode: "PLANLOFT_DOCUMENT_FORMAT_INVALID" };
  }
  if (
    /^(?:Stdin input must be supplied|Invalid JSON document:|A JSON document must be an object|Unknown JSON document field|Unsupported JSON document version:|A JSON document requires a string "content" field|"contentFormat" must be)/.test(
      message,
    )
  ) {
    return { diagnosticCode: "PLANLOFT_DOCUMENT_INPUT_INVALID" };
  }
  return undefined;
}

const ERROR_STAGES = new Set<ApplicationErrorStage>([
  "render",
  "authentication",
  "host",
  "cleanup",
]);

const DIAGNOSTIC_CODES = new Set<ApplicationDiagnosticCode>([
  "MDX_SYNTAX", "MDX_IMPORT", "MDX_COMPONENT", "MDX_COMPONENT_INPUT",
  "PLANLOFT_COLLABORATION_MARKERS_INVALID", "PLANLOFT_COLLABORATION_BUILD_FAILED",
  "PLANLOFT_MIGRATION_UNSUPPORTED_FORMAT", "PLANLOFT_MIGRATION_UNSUPPORTED_CONTENT",
  "PLANLOFT_MIGRATION_INVALID_SOURCE", "PLANLOFT_MIGRATION_PATH_CONFLICT",
  "PLANLOFT_MIGRATION_DESTINATION_CONFLICT", "PLANLOFT_MIGRATION_BACKUP_CONFLICT",
  "PLANLOFT_CONFIG_MALFORMED",
  "PLANLOFT_CONFIG_INACCESSIBLE",
  "PLANLOFT_CONFIG_INVALID",
  "PLANLOFT_CONFIG_MIGRATION_REQUIRED",
  "PLANLOFT_THEME_INVALID_NAME",
  "PLANLOFT_THEME_MISSING",
  "PLANLOFT_THEME_INACCESSIBLE",
  "PLANLOFT_THEME_INVALID_ASSET",
  "PLANLOFT_THEME_LEGACY_ASSET",
  "PLANLOFT_DOCUMENT_METADATA_INVALID",
  "PLANLOFT_DOCUMENT_INPUT_INVALID",
  "PLANLOFT_DOCUMENT_FORMAT_INVALID",
  "PLANLOFT_RESOLVE_FORMAT_INVALID",
  "PLANLOFT_TRUSTED_HTML_REQUIRED",
  "PLANLOFT_TRUSTED_MDX_REQUIRED",
  "PLANLOFT_MDX_SNAPSHOT_STALE",
  "PLANLOFT_DIRECT_HTML_OPTION_UNSUPPORTED",
  "PLANLOFT_RENDER_SUPPORT_CONFLICT",
  "PLANLOFT_HTML_FRAMESET_UNSUPPORTED",
  "PLANLOFT_TTL_INVALID",
  "PLANLOFT_EXPIRY_INVALID",
  "PLANLOFT_GISCUS_CONFIG_INCOMPLETE",
  "PLANLOFT_GITHUB_AUTH_MISSING",
  "PLANLOFT_GITHUB_AUTH_INVALID",
  "PLANLOFT_GITHUB_AUTH_UNREACHABLE",
  "PLANLOFT_DOCUMENT_NOT_FOUND",
  "PLANLOFT_VERCEL_CONFIG_INVALID",
  "PLANLOFT_VERCEL_FAILED",
  "PLANLOFT_CLOUDFLARE_CONFIG_INVALID",
  "PLANLOFT_CLOUDFLARE_FAILED",
  "PLANLOFT_HOST_INVALID",
  "PLANLOFT_HOSTING_INVALID",
  "PLANLOFT_COPY_CONFLICT",
]);

const DIAGNOSTIC_FIELDS = new Set<ApplicationDiagnosticField>([
  "title",
  "slug",
  "kind",
  "theme",
  "status",
]);

function safeAuthoringDetails(value: Record<string, unknown>): Pick<PlanloftApplicationErrorDetails, "component" | "reason" | "location" | "imported"> {
  const location = inspectOwnDataProperties(value.location, ["line", "column", "file"]);
  const line = location.safe ? safePosition(location.values.line) : undefined;
  const column = location.safe ? safePosition(location.values.column) : undefined;
  const file = location.safe && typeof location.values.file === "string" && location.values.file.length <= 160 && /^(?!\.\.(?:\/|$))(?!\/)[A-Za-z0-9._/-]+$/.test(location.values.file) && !location.values.file.split("/").includes("..") ? location.values.file : undefined;
  return {
    ...(isBuiltinComponentName(value.component) ? { component: value.component } : {}),
    ...(isComponentInputReason(value.reason) ? { reason: value.reason } : {}),
    ...(value.imported === true ? { imported: true } : {}),
    ...(line === undefined ? {} : { location: Object.freeze({ line, ...(column === undefined ? {} : { column }), ...(file === undefined ? {} : { file }) }) }),
  };
}

function safePosition(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= 9999999 ? value : undefined;
}

function migrationApplicationError(error: MigrationError): PlanloftApplicationError {
  const match = /\bat line (\d{1,7}), column (\d{1,7})\b/.exec(error.message);
  return applicationError(error.code === "DESTINATION_CONFLICT" || error.code === "BACKUP_CONFLICT" ? "conflict" : "validation", "migrate", {
    diagnosticCode: `PLANLOFT_MIGRATION_${error.code}`,
    ...(match ? { location: { line: Number(match[1]), column: Number(match[2]) } } : {}),
  });
}

function sanitizeErrorDetails(details: unknown): PlanloftApplicationErrorDetails {
  const inspected = inspectOwnDataProperties(details, ["stage", "diagnosticCode", "field", "component", "reason", "location", "imported"]);
  if (!inspected.safe) return {};
  const stage = validStage(inspected.values.stage);
  const diagnosticCode = validDiagnostic(inspected.values.diagnosticCode);
  const field = validField(inspected.values.field);
  return {
    ...(stage === undefined ? {} : { stage }),
    ...(diagnosticCode === undefined ? {} : { diagnosticCode }),
    ...(field === undefined ? {} : { field }),
    ...safeAuthoringDetails(inspected.values),
  };
}

const CAUGHT_VALUE_PROPERTIES = [
  "name",
  "category",
  "operation",
  "stage",
  "diagnosticCode",
  "field",
  "code",
  "message",
  "component", "reason", "location", "imported",
] as const;

type InspectedValues = Record<(typeof CAUGHT_VALUE_PROPERTIES)[number] | "stage" | "diagnosticCode" | "field", unknown>;

function inspectCaughtValue(value: unknown): { safe: true; values: InspectedValues } | { safe: false } {
  return inspectOwnDataProperties(value, CAUGHT_VALUE_PROPERTIES);
}

function isNamedDataError(value: unknown, expectedName: string): boolean {
  const inspected = inspectOwnDataProperties(value, ["name"] as const);
  return inspected.safe && inspected.values.name === expectedName;
}

function inspectOwnDataProperties<const K extends readonly string[]>(
  value: unknown,
  properties: K,
): { safe: true; values: Record<K[number], unknown> } | { safe: false } {
  const values = Object.create(null) as Record<K[number], unknown>;
  if ((typeof value !== "object" || value === null) && typeof value !== "function") {
    return { safe: true, values };
  }
  try {
    for (const property of properties) {
      const descriptor = Object.getOwnPropertyDescriptor(value, property);
      if (descriptor === undefined) continue;
      if (!("value" in descriptor)) return { safe: false };
      values[property as K[number]] = descriptor.value;
    }
    return { safe: true, values };
  } catch {
    return { safe: false };
  }
}

function validCategory(value: unknown): ApplicationErrorCategory | undefined {
  return typeof value === "string" && APPLICATION_ERROR_CATEGORIES.includes(value as ApplicationErrorCategory)
    ? value as ApplicationErrorCategory
    : undefined;
}

function validOperation(value: unknown): ApplicationOperation | undefined {
  return typeof value === "string" && APPLICATION_OPERATIONS.has(value as ApplicationOperation)
    ? value as ApplicationOperation
    : undefined;
}

function validStage(value: unknown): ApplicationErrorStage | undefined {
  return typeof value === "string" && ERROR_STAGES.has(value as ApplicationErrorStage)
    ? value as ApplicationErrorStage
    : undefined;
}

function validDiagnostic(value: unknown): ApplicationDiagnosticCode | undefined {
  return typeof value === "string" && DIAGNOSTIC_CODES.has(value as ApplicationDiagnosticCode)
    ? value as ApplicationDiagnosticCode
    : undefined;
}

function validField(value: unknown): ApplicationDiagnosticField | undefined {
  return typeof value === "string" && DIAGNOSTIC_FIELDS.has(value as ApplicationDiagnosticField)
    ? value as ApplicationDiagnosticField
    : undefined;
}

function validConfigDiagnostic(value: unknown): value is ConfigDiagnosticCode {
  return typeof value === "string" && value.startsWith("PLANLOFT_CONFIG_") && DIAGNOSTIC_CODES.has(value as ApplicationDiagnosticCode);
}

function validThemeDiagnostic(value: unknown): value is ThemeDiagnosticCode {
  return typeof value === "string" && value.startsWith("PLANLOFT_THEME_") && DIAGNOSTIC_CODES.has(value as ApplicationDiagnosticCode);
}

function immutableProperty(value: unknown, enumerable: boolean): PropertyDescriptor {
  return { value, enumerable, writable: false, configurable: false };
}

function applicationErrorMessage(
  category: ApplicationErrorCategory,
  operation: ApplicationOperation,
  details: PlanloftApplicationErrorDetails,
): string {
  const label = operation === "remove"
    ? "Remove"
    : operation.charAt(0).toUpperCase() + operation.slice(1);
  const diagnostic = details.diagnosticCode;
  const prefix = diagnostic ? `[${diagnostic}] ` : "";
  const location = details.location;
  const position = location ? ` at line ${location.line}${location.column === undefined ? "" : `, column ${location.column}`}` : "";
  const context = details.imported ? location?.file ? ` in imported MDX ${location.file}` : " in an imported MDX file" : "";
  const messages: Partial<Record<ApplicationDiagnosticCode, string>> = {
    MDX_SYNTAX: `MDX syntax error${context}${position}. Check the document and imported MDX.`,
    MDX_IMPORT: "An MDX import could not be resolved. Check the import and its source location.",
    MDX_COMPONENT: "An MDX component is missing. Import it or add it to a component registry.",
    MDX_COMPONENT_INPUT: details.component ? `Invalid data or props for <${details.component}>${details.reason ? ` (${details.reason})` : ""}. Check the component inputs.` : "Invalid component inputs.",
    PLANLOFT_COLLABORATION_BUILD_FAILED: "Collaboration service build failed. Check the provider and installed package assets.",
    PLANLOFT_COLLABORATION_MARKERS_INVALID: "Collaboration markers are invalid. Restore the original HTML or repair the complete attachment block.",
    PLANLOFT_MIGRATION_UNSUPPORTED_FORMAT: "Migration supports Markdown to .mdx or HTML to the same HTML extension only.",
    PLANLOFT_MIGRATION_UNSUPPORTED_CONTENT: `Unsupported content${position} needs manual conversion before migration.`,
    PLANLOFT_MIGRATION_INVALID_SOURCE: "Migration source is invalid. Check encoding and document structure.",
    PLANLOFT_MIGRATION_PATH_CONFLICT: "Source, destination, and backup must be separate paths.",
    PLANLOFT_MIGRATION_DESTINATION_CONFLICT: "Destination already exists with different content. Choose a different destination.",
    PLANLOFT_MIGRATION_BACKUP_CONFLICT: "Backup already exists with different content. Resolve the backup conflict before migrating.",
    PLANLOFT_CONFIG_MALFORMED: "Configuration JSON is malformed. Fix config.json and try again.",
    PLANLOFT_CONFIG_INACCESSIBLE: "Configuration is inaccessible. Check Planloft home permissions and try again.",
    PLANLOFT_CONFIG_INVALID: "Configuration is semantically invalid. Check supported fields and values.",
    PLANLOFT_CONFIG_MIGRATION_REQUIRED: "Configuration uses a removed setting. Remove planFormat from config.json.",
    PLANLOFT_THEME_INVALID_NAME: "The selected theme name is invalid. Use letters, numbers, dots, underscores, or hyphens.",
    PLANLOFT_THEME_MISSING: "The selected theme does not exist. Install it or choose an available theme.",
    PLANLOFT_THEME_INACCESSIBLE: "The selected theme is inaccessible. Check theme permissions and try again.",
    PLANLOFT_THEME_INVALID_ASSET: "The selected theme contains an invalid asset.",
    PLANLOFT_THEME_LEGACY_ASSET: "The selected theme contains template.md, template.mdx, or layout.html. Back it up, move authored content into a Markdown, MDX, or HTML source file, and convert theme styling to CSS variables in style.css.",
    PLANLOFT_DOCUMENT_METADATA_INVALID: details.field
      ? `Document metadata "${details.field}" must be a nonblank string when provided.`
      : "Document metadata is invalid.",
    PLANLOFT_DOCUMENT_INPUT_INVALID: "Document input is invalid. Check its structure and required fields.",
    PLANLOFT_RESOLVE_FORMAT_INVALID: "Resolve format is invalid. Use md, mdx, or html.",
    PLANLOFT_DOCUMENT_FORMAT_INVALID: "Document format is invalid. Use md, mdx, json, or html and specify stdin format explicitly.",
    PLANLOFT_TRUSTED_MDX_REQUIRED: "MDX executes code. Pass --trusted-mdx only for content you trust.",
    PLANLOFT_MDX_SNAPSHOT_STALE: "Stored MDX has changed since its dependencies were compiled. Restore the source dependencies and compile again; <source>.bundle.js cannot be reused.",
    PLANLOFT_TRUSTED_HTML_REQUIRED: "HTML input is disabled by default. Enable trusted HTML only for content you trust.",
    PLANLOFT_HTML_FRAMESET_UNSUPPORTED: "Frameset HTML is not supported. Convert it to a document with an ordinary body, or keep the original externally.",
    PLANLOFT_RENDER_SUPPORT_CONFLICT: "Existing Planloft support is ambiguous or conflicts with the document. Regenerate from the original source, or review legacy generated support in a separate candidate before migrating.",
    PLANLOFT_DIRECT_HTML_OPTION_UNSUPPORTED: "Comments cannot be added to authored HTML. Add them to the source instead.",
    PLANLOFT_TTL_INVALID: "TTL must be a supported finite positive integer.",
    PLANLOFT_EXPIRY_INVALID: "TTL does not produce a representable expiry from the current time.",
    PLANLOFT_GISCUS_CONFIG_INCOMPLETE: "Comments require complete valid giscus configuration.",
    PLANLOFT_GITHUB_AUTH_MISSING: "GitHub authentication is missing. Authenticate with gh or configure a token.",
    PLANLOFT_GITHUB_AUTH_INVALID: "GitHub rejected the configured credential. Authenticate again and retry.",
    PLANLOFT_GITHUB_AUTH_UNREACHABLE: "GitHub authentication could not be validated. Check connectivity and retry.",
    PLANLOFT_DOCUMENT_NOT_FOUND: "No matching stored document was found.",
    PLANLOFT_VERCEL_CONFIG_INVALID: "Set vercel.project to a lowercase project name and vercel.url to an HTTPS origin, if used.",
    PLANLOFT_VERCEL_FAILED: "Vercel deployment failed. Install the Vercel CLI, run vercel login, and check project permissions. The repository push may have succeeded; retry deploy.",
    PLANLOFT_CLOUDFLARE_CONFIG_INVALID: "Set cloudflare.worker, cloudflare.accountId, and cloudflare.url to the stable workers.dev origin.",
    PLANLOFT_CLOUDFLARE_FAILED: "Cloudflare deployment could not be confirmed. Check Wrangler authentication, account permissions, and cloudflare.url against the actual worker URL. The Worker upload and repository push may have succeeded; correct the configuration and retry deploy.",
    PLANLOFT_HOST_INVALID: "Choose --host github-pages, --host vercel, or --host cloudflare.",
    PLANLOFT_HOSTING_INVALID: "Hosting layout or manifest is invalid. Check for conflicting public paths, symlinks, missing plan files, and invalid manifest entries before retrying.",
    PLANLOFT_COPY_CONFLICT: "Copy would overwrite an existing repository document. Retry with force to replace it.",
  };
  if (diagnostic && messages[diagnostic]) return `${prefix}${messages[diagnostic]}`;

  const fallbacks: Record<ApplicationErrorCategory, string> = {
    validation: `${label} input is invalid. Check command arguments and document metadata.`,
    not_found: `${label} could not find the requested document.`,
    conflict: `${label} conflicts with existing state.`,
    configuration: `${label} could not use Planloft configuration.`,
    local_effect: details.stage
      ? `${label} failed during the ${details.stage} stage of a local effect.`
      : `${label} failed during a local effect.`,
    external_effect: details.stage
      ? `${label} failed during the ${details.stage} stage of an external effect.`
      : `${label} failed during an external effect.`,
    internal: `${label} failed because of an internal application error.`,
  };
  return fallbacks[category];
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
