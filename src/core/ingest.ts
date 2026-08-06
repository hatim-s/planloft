import path from "node:path";
import * as fm from "./frontmatter.js";
import { slugify } from "./slug.js";
import type {
  CanonicalDocument,
  JsonDocument,
  Kind,
  PlanFormat,
  SourceFormat,
} from "./types.js";

export interface DocumentOverrides {
  title?: string;
  slug?: string;
  kind?: Kind;
  theme?: string;
  status?: string;
}

export interface IngestOptions {
  format: SourceFormat;
  sourceName?: string;
  defaults?: DocumentOverrides;
  overrides?: DocumentOverrides;
  trustedHtml?: boolean;
}

/** Normalize Markdown, JSON, or trusted HTML into one canonical document. */
export function ingestDocument(raw: string, options: IngestOptions): CanonicalDocument {
  const sourceName = options.sourceName ? path.basename(options.sourceName) : "document";
  const fallbackSlug = sourceName.replace(/\.(md|markdown|html?|json)$/i, "");

  if (options.format === "json") {
    return ingestJson(raw, options, fallbackSlug);
  }

  if (options.format === "html" && !options.trustedHtml) {
    throw new Error(
      "HTML input is disabled by default. Pass the trusted-HTML option only for content you trust.",
    );
  }

  const parsed = options.format === "md" ? fm.parse(raw) : { data: {}, content: raw };
  const data = parsed.data;
  return canonical({
    content: parsed.content,
    contentFormat: options.format,
    trustedHtml: !!options.trustedHtml,
    fallbackSlug,
    defaults: options.defaults,
    source: {
      title: stringValue(data.title),
      slug: stringValue(data.slug),
      kind: stringValue(data.kind) as Kind | undefined,
      theme: stringValue(data.theme),
      status: stringValue(data.status),
    },
    overrides: options.overrides,
  });
}

/** Infer an ingestion adapter from a filename. Stdin callers should pass a format. */
export function sourceFormatFromPath(file: string): SourceFormat {
  const ext = path.extname(file).toLowerCase();
  if (ext === ".json") return "json";
  if (ext === ".html" || ext === ".htm") return "html";
  if (ext === ".md" || ext === ".markdown") return "md";
  throw new Error(`Cannot infer input format from ${file}. Use --format md|json|html.`);
}

function ingestJson(raw: string, options: IngestOptions, fallbackSlug: string): CanonicalDocument {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Invalid JSON document: ${(error as Error).message}`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("A JSON document must be an object.");
  }

  const doc = value as Partial<JsonDocument>;
  const allowed = new Set([
    "version",
    "title",
    "slug",
    "kind",
    "theme",
    "status",
    "contentFormat",
    "content",
  ]);
  const unknown = Object.keys(doc).filter((key) => !allowed.has(key));
  if (unknown.length) {
    throw new Error(`Unknown JSON document field${unknown.length === 1 ? "" : "s"}: ${unknown.join(", ")}.`);
  }
  if (doc.version !== undefined && doc.version !== 1) {
    throw new Error(`Unsupported JSON document version: ${String(doc.version)}.`);
  }
  if (typeof doc.content !== "string") {
    throw new Error('A JSON document requires a string "content" field.');
  }
  for (const field of ["title", "slug", "kind", "theme", "status"] as const) {
    if (doc[field] !== undefined && typeof doc[field] !== "string") {
      throw new Error(`"${field}" must be a string.`);
    }
  }
  const contentFormat = doc.contentFormat ?? "md";
  if (contentFormat !== "md" && contentFormat !== "html") {
    throw new Error('"contentFormat" must be "md" or "html".');
  }
  if (contentFormat === "html" && !options.trustedHtml) {
    throw new Error(
      "JSON HTML content is disabled by default. Pass the trusted-HTML option only for content you trust.",
    );
  }

  return canonical({
    content: doc.content,
    contentFormat,
    trustedHtml: !!options.trustedHtml,
    fallbackSlug,
    defaults: options.defaults,
    source: {
      title: stringValue(doc.title),
      slug: stringValue(doc.slug),
      kind: stringValue(doc.kind) as Kind | undefined,
      theme: stringValue(doc.theme),
      status: stringValue(doc.status),
    },
    overrides: options.overrides,
  });
}

function canonical(input: {
  content: string;
  contentFormat: PlanFormat;
  trustedHtml: boolean;
  fallbackSlug: string;
  defaults?: DocumentOverrides;
  source: DocumentOverrides;
  overrides?: DocumentOverrides;
}): CanonicalDocument {
  const merged = { ...input.defaults, ...defined(input.source), ...defined(input.overrides) };
  const inferredTitle = firstHeading(input.content) ?? merged.slug ?? input.fallbackSlug ?? "Document";
  const title = merged.title?.trim() || inferredTitle;

  return {
    version: 1,
    title,
    slug: slugify(merged.slug ?? title),
    kind: merged.kind ?? "plan",
    theme: merged.theme,
    status: merged.status ?? "active",
    contentFormat: input.contentFormat,
    content: input.content,
    trustedHtml: input.trustedHtml,
  };
}

function firstHeading(markdown: string): string | undefined {
  const match = /^#\s+(.+)$/m.exec(markdown);
  return match?.[1]?.trim();
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function defined<T extends object>(value: T | undefined): Partial<T> {
  if (!value) return {};
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as Partial<T>;
}
