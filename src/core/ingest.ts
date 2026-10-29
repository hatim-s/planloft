import path from "node:path";
import { marked } from "marked";
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
  trustedMdx?: boolean;
}

export class DocumentTrustError extends Error {
  constructor(readonly code: "PLANLOFT_TRUSTED_MDX_REQUIRED" | "PLANLOFT_TRUSTED_HTML_REQUIRED") {
    super(code === "PLANLOFT_TRUSTED_MDX_REQUIRED" ? "MDX executes code. Pass --trusted-mdx only for content you trust." : "HTML input is disabled by default. Enable trusted HTML only for content you trust.");
    this.name = "DocumentTrustError";
  }
}

/** Normalize Markdown, JSON, or trusted HTML into one canonical document. */
export function ingestDocument<Format extends PlanFormat>(raw: string, options: IngestOptions & { format: Format }): CanonicalDocument<Format>;
export function ingestDocument(raw: string, options: IngestOptions): CanonicalDocument;
export function ingestDocument(raw: string, options: IngestOptions): CanonicalDocument {
  const sourceName = options.sourceName ? path.basename(options.sourceName) : "document";
  const fallbackSlug = sourceName.replace(/\.(md|mdx|markdown|html?|json)$/i, "");

  if (options.format === "json") {
    return ingestJson(raw, options, fallbackSlug);
  }

  if (options.format === "html" && !options.trustedHtml) {
    throw new DocumentTrustError("PLANLOFT_TRUSTED_HTML_REQUIRED");
  }

  if (options.format === "mdx" && !options.trustedMdx) {
    throw new DocumentTrustError("PLANLOFT_TRUSTED_MDX_REQUIRED");
  }

  const parsed = options.format === "md" || options.format === "mdx" ? fm.parse(raw) : { data: {}, content: raw };
  const source = normalizeDocumentMetadata(parsed.data, "Markdown frontmatter");
  const document = canonical({
    content: parsed.content,
    contentFormat: options.format,
    trustedHtml: !!options.trustedHtml,
    fallbackSlug,
    defaults: options.defaults,
    source,
    overrides: options.overrides,
  });
  if (options.format === "mdx") {
    document.sourceLineOffset = raw.endsWith(parsed.content)
      ? (raw.slice(0, raw.length - parsed.content.length).match(/\n/g) ?? []).length
      : null;
  }
  return document;
}

/** Infer an ingestion adapter from a filename. Stdin callers should pass a format. */
export function sourceFormatFromPath(file: string): SourceFormat {
  const ext = path.extname(file).toLowerCase();
  if (ext === ".json") return "json";
  if (ext === ".html" || ext === ".htm") return "html";
  if (ext === ".mdx") return "mdx";
  if (ext === ".md" || ext === ".markdown") return "md";
  throw new Error(`Cannot infer input format from ${file}. Use --format md|mdx|json|html.`);
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
  const source = normalizeDocumentMetadata(doc, "JSON document");
  const contentFormat = doc.contentFormat ?? "md";
  if (contentFormat !== "md" && contentFormat !== "mdx" && contentFormat !== "html") {
    throw new Error('"contentFormat" must be "md", "mdx", or "html".');
  }
  if (contentFormat === "mdx" && !options.trustedMdx) {
    throw new DocumentTrustError("PLANLOFT_TRUSTED_MDX_REQUIRED");
  }
  if (contentFormat === "html" && !options.trustedHtml) {
    throw new DocumentTrustError("PLANLOFT_TRUSTED_HTML_REQUIRED");
  }

  const document = canonical({
    content: doc.content,
    contentFormat,
    trustedHtml: !!options.trustedHtml,
    fallbackSlug,
    defaults: options.defaults,
    source,
    overrides: options.overrides,
  });
  if (contentFormat === "mdx") document.sourceLineOffset = null;
  return document;
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
  const merged = {
    ...normalizeDocumentMetadata(input.defaults, "document defaults"),
    ...input.source,
    ...normalizeDocumentMetadata(input.overrides, "document overrides"),
  };
  const inferredTitle =
    (input.contentFormat !== "html" ? firstMarkdownHeading(input.content) : undefined) ??
    merged.slug ??
    input.fallbackSlug ??
    "Document";
  const title = merged.title ?? inferredTitle;

  return {
    version: 1,
    title,
    slug: slugify(merged.slug ?? title),
    kind: merged.kind ?? "plan",
    theme: merged.theme,
    status: merged.status ?? "active",
    contentFormat: input.contentFormat,
    content: input.content,
    sourceLineOffset: null,
    trustedHtml: input.trustedHtml,
  };
}

/** Infer a title only from the first parsed level-one Markdown heading. */
function firstMarkdownHeading(markdown: string): string | undefined {
  const heading = marked
    .lexer(markdown)
    .find((token) => token.type === "heading" && token.depth === 1);
  return heading?.type === "heading" && heading.text.trim() ? heading.text.trim() : undefined;
}

/** Validate and trim document metadata consistently across every ingestion surface. */
export function normalizeDocumentMetadata(
  value: Partial<Record<keyof DocumentOverrides, unknown>> | undefined,
  source: string,
): DocumentOverrides {
  if (!value) return {};
  const normalized: DocumentOverrides = {};
  for (const field of ["title", "slug", "kind", "theme", "status"] as const) {
    const entry = value[field];
    if (entry === undefined) continue;
    if (typeof entry !== "string" || entry.trim() === "") {
      throw new Error(`${source} metadata "${field}" must be a nonblank string when provided.`);
    }
    Object.assign(normalized, { [field]: entry.trim() });
  }
  return normalized;
}
