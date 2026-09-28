import fs from "node:fs";
import { ingestDocument } from "../core/ingest.js";
import { sourceFormatFromPath } from "../core/ingest.js";
import type { CanonicalDocument, Kind, SourceFormat } from "../core/types.js";

export interface SourceFlags {
  format?: string;
  title?: string;
  slug?: string;
  kind?: string;
  theme?: string;
  status?: string;
  trustedHtml?: boolean;
  /** Raw stdin supplied by an adapter when input is "-". */
  stdin?: string;
}

export interface SourceReader {
  readText(file: string): string;
  readBytes?(file: string): Uint8Array;
}

export async function readCanonicalDocument(
  input: string,
  flags: SourceFlags,
  reader: SourceReader = {
    readText: (file) => fs.readFileSync(file, "utf8"),
    readBytes: (file) => fs.readFileSync(file),
  },
): Promise<CanonicalDocument> {
  const format = flags.format ? parseSourceFormat(flags.format) : inferFormat(input);
  if (input === "-" && flags.stdin === undefined) {
    throw new Error('Stdin input must be supplied by the calling adapter.');
  }
  const raw = input === "-"
    ? flags.stdin!
    : format === "html" && reader.readBytes
      ? new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(reader.readBytes(input))
      : reader.readText(input);
  return ingestDocument(raw, {
    format,
    sourceName: input === "-" ? undefined : input,
    trustedHtml: !!flags.trustedHtml,
    overrides: {
      title: flags.title,
      slug: flags.slug,
      kind: flags.kind as Kind | undefined,
      theme: flags.theme,
      status: flags.status,
    },
  });
}

function inferFormat(input: string): SourceFormat {
  if (input === "-") {
    throw new Error("Stdin input requires --format md|json|html.");
  }
  return sourceFormatFromPath(input);
}

function parseSourceFormat(value: string): SourceFormat {
  const normalized = value === "markdown" ? "md" : value;
  if (normalized !== "md" && normalized !== "json" && normalized !== "html") {
    throw new Error("Input format must be md, json, or html.");
  }
  return normalized;
}
