import fs from "node:fs";
import path from "node:path";
import { createPlanloftConfiguration, type PlanloftConfiguration } from "./configuration.js";
import { docDir, docFile } from "./core/doc.js";
import * as fm from "./core/frontmatter.js";
import { indexPath } from "./core/paths.js";
import { gitRoot, projectKey } from "./core/project.js";
import type {
  CanonicalDocument,
  DocMeta,
  IndexFile,
  Kind,
  ProjectEntry,
} from "./core/types.js";

export interface PersistenceFileSystem {
  readText(file: string): string;
  readBytes(file: string): Uint8Array;
  writeText(file: string, contents: string): void;
  writeBytes(file: string, contents: Uint8Array): void;
  exists(file: string): boolean;
  makeDirectory(directory: string): void;
  removeFile(file: string): void;
}

export interface DocumentPersistenceOptions {
  cwd?: string;
  clock?: () => Date;
  fileSystem?: PersistenceFileSystem;
  configuration?: PlanloftConfiguration;
}

export interface HoistOptions {
  cwd?: string;
  now?: Date;
}

export interface CopyStoredDocumentResult {
  document: DocMeta;
  path: string;
  relativePath: string;
  usedCurrentDirectory: boolean;
  replaced: boolean;
}

export interface RemoveStoredDocumentResult {
  document: DocMeta;
  sourceRemoved: boolean;
}

export class DocumentCopyConflictError extends Error {
  constructor(readonly path: string) {
    super(`Refusing to overwrite ${path}. Re-run with --force to replace it.`);
    this.name = "DocumentCopyConflictError";
  }
}

export interface DocumentPersistence {
  project(): { key: string; label: string };
  ensureProject(): ProjectEntry;
  list(): IndexFile;
  find(slug?: string): DocMeta | undefined;
  hoist(document: CanonicalDocument, now?: Date): DocMeta;
  capture(file: string, now?: Date): DocMeta | null;
  copy(slug?: string, options?: { force?: boolean }): CopyStoredDocumentResult | undefined;
  remove(slug: string): RemoveStoredDocumentResult | undefined;
}

const nativeFileSystem: PersistenceFileSystem = {
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

/**
 * The single persistence interface for canonical hoisting, write-direct capture,
 * index mutation, lookup, repository copy, replacement, and removal.
 */
export function createDocumentPersistence(
  options: DocumentPersistenceOptions = {},
): DocumentPersistence {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const clock = options.clock ?? (() => new Date());
  const files = options.fileSystem ?? nativeFileSystem;
  const configuration = options.configuration ?? createPlanloftConfiguration();
  const identity = () => projectKey(cwd);

  const saveIndex = (index: IndexFile): void => {
    files.makeDirectory(path.dirname(indexPath()));
    files.writeText(indexPath(), JSON.stringify(index, null, 2) + "\n");
  };

  const upsert = (meta: DocMeta): void => {
    const index = loadIndex(files);
    ensureProjectEntry(index, identity()).docs[meta.slug] = meta;
    saveIndex(index);
  };

  const find = (slug?: string): DocMeta | undefined => {
    const docs = Object.values(loadIndex(files).projects[identity().key]?.docs ?? {});
    if (slug !== undefined) return docs.find((document) => document.slug === slug);
    return docs.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
  };

  return {
    project: identity,

    ensureProject() {
      const index = loadIndex(files);
      const entry = ensureProjectEntry(index, identity());
      saveIndex(index);
      files.makeDirectory(docDir(entry.label));
      return entry;
    },

    list: () => loadIndex(files),
    find,

    hoist(document, now = clock()) {
      const project = identity();
      // Validate configuration and the selected theme without mutating first, then
      // persist defaults before the first document-store write.
      configuration.resolveProject(project.key, document.theme);
      configuration.ensure();
      const file = docFile(project.label, document.slug, document.contentFormat);
      const previous = find(document.slug);
      const source = serializeCanonicalDocument(document);

      files.makeDirectory(docDir(project.label));
      files.writeText(file, source);

      const meta: DocMeta = {
        slug: document.slug,
        title: document.title,
        kind: document.kind,
        project: project.key,
        theme: document.theme,
        status: document.status,
        format: document.contentFormat,
        trustedHtml: document.trustedHtml,
        file: path.resolve(file),
        updatedAt: now.toISOString(),
      };
      upsert(meta);
      removeReplacedFormat(files, previous, file);
      return meta;
    },

    capture(file, now = clock()) {
      if (!files.exists(file)) return null;
      const project = identity();
      const format = file.endsWith(".html") ? "html" : "md";
      const slug = path.basename(file).replace(/\.(md|html)$/, "");
      const existing = find(slug);

      if (format === "md") {
        const { data, content } = fm.parse(files.readText(file));
        const kind: Kind =
          typeof data.kind === "string" && data.kind ? data.kind : existing?.kind ?? "note";
        const title = data.title ?? existing?.title ?? slug;
        const status = data.status ?? existing?.status ?? "active";
        const preserved: fm.Frontmatter = {
          ...data,
          title,
          slug,
          kind,
          status,
        };
        const theme = typeof data.theme === "string" ? data.theme : existing?.theme;
        configuration.resolveProject(project.key, theme);
        files.writeText(file, fm.stringify(content, preserved));
        const meta: DocMeta = {
          slug,
          title: String(title),
          kind,
          project: project.key,
          theme,
          status: String(status),
          format,
          trustedHtml: existing?.trustedHtml,
          file: path.resolve(file),
          updatedAt: now.toISOString(),
        };
        upsert(meta);
        removeReplacedFormat(files, existing, file);
        return meta;
      }

      const meta: DocMeta = {
        slug,
        title: existing?.title ?? slug,
        kind: existing?.kind ?? "note",
        project: project.key,
        theme: existing?.theme,
        status: existing?.status ?? "active",
        format,
        trustedHtml: existing?.trustedHtml,
        file: path.resolve(file),
        updatedAt: now.toISOString(),
      };
      upsert(meta);
      removeReplacedFormat(files, existing, file);
      return meta;
    },

    copy(slug, copyOptions = {}) {
      const document = find(slug);
      if (!document) return undefined;
      const root = gitRoot(cwd);
      const destination = path.join(root ?? cwd, ".planloft", "plans", path.basename(document.file));
      const replaced = files.exists(destination);
      if (replaced && !copyOptions.force) {
        throw new DocumentCopyConflictError(destination);
      }
      const contents = files.readBytes(document.file);
      files.makeDirectory(path.dirname(destination));
      files.writeBytes(destination, contents);
      return {
        document,
        path: destination,
        relativePath: path.relative(root ?? cwd, destination),
        usedCurrentDirectory: root === null,
        replaced,
      };
    },

    remove(slug) {
      const document = find(slug);
      if (!document) return undefined;
      let sourceRemoved = false;
      try {
        files.removeFile(document.file);
        sourceRemoved = true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      const index = loadIndex(files);
      const entry = index.projects[identity().key];
      if (entry) delete entry.docs[slug];
      saveIndex(index);
      return { document, sourceRemoved };
    },
  };
}

/** Compatibility compiler export backed by the shared persistence implementation. */
export function hoistDocument(document: CanonicalDocument, options: HoistOptions = {}): DocMeta {
  return createDocumentPersistence({ cwd: options.cwd }).hoist(document, options.now);
}

function loadIndex(files: Pick<PersistenceFileSystem, "readText">): IndexFile {
  try {
    return JSON.parse(files.readText(indexPath())) as IndexFile;
  } catch {
    return { version: 1, projects: {} };
  }
}

function ensureProjectEntry(
  index: IndexFile,
  project: { key: string; label: string },
): ProjectEntry {
  const existing = index.projects[project.key];
  if (existing) return existing;
  const entry: ProjectEntry = {
    key: project.key,
    label: project.label,
    dir: project.label,
    docs: {},
  };
  index.projects[project.key] = entry;
  return entry;
}

function serializeCanonicalDocument(document: CanonicalDocument): string {
  if (document.contentFormat === "html") return document.content;
  const frontmatter: fm.Frontmatter = {
    title: document.title,
    slug: document.slug,
    kind: document.kind,
    status: document.status,
  };
  if (document.theme) frontmatter.theme = document.theme;
  return fm.stringify(document.content, frontmatter);
}

function removeReplacedFormat(
  files: PersistenceFileSystem,
  previous: DocMeta | undefined,
  replacementFile: string,
): void {
  if (
    previous?.file !== replacementFile &&
    previous?.file &&
    files.exists(previous.file)
  ) {
    files.removeFile(previous.file);
  }
}
