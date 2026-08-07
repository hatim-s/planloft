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
}

export async function readCanonicalDocument(
  input: string,
  flags: SourceFlags,
): Promise<CanonicalDocument> {
  const format = flags.format ? parseSourceFormat(flags.format) : inferFormat(input);
  const raw = input === "-" ? await readStdin() : fs.readFileSync(input, "utf8");
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

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}
