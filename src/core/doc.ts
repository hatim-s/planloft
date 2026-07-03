import fs from "node:fs";
import path from "node:path";
import { docsDir } from "./paths.js";
import * as fm from "./frontmatter.js";
import { upsertDoc } from "./store.js";
import type { DocMeta, Kind, PlanFormat } from "./types.js";

// Built-in kinds (ADR-0002). Custom kinds (any string) are also allowed.
export const BUILTIN_KINDS: readonly Kind[] = [
  "plan",
  "adr",
  "review",
  "research",
  "report",
  "note",
];

export function docDir(label: string): string {
  return path.join(docsDir(), label);
}

// Flat layout: docs/<project>/<slug>.<ext>; kind lives in frontmatter (ADR-0002).
export function docFile(label: string, slug: string, format: PlanFormat): string {
  return path.join(docDir(label), `${slug}.${format}`);
}

/**
 * Read a doc file under the store, fill missing frontmatter defaults (incl. `kind`), and
 * sync its metadata into index.json. Idempotent. Called by the PostToolUse hook
 * (ADR-0001 §D2, §D6; ADR-0002) after any capture skill writes a doc.
 */
export function normalizeDocFile(absPath: string, key: string, label: string): DocMeta | null {
  if (!fs.existsSync(absPath)) return null;

  const format: PlanFormat = absPath.endsWith(".html") ? "html" : "md";
  const slug = path.basename(absPath).replace(/\.(md|html)$/, "");
  const now = new Date().toISOString();

  if (format === "md") {
    const { data, content } = fm.parse(fs.readFileSync(absPath, "utf8"));
    const kind: Kind = typeof data.kind === "string" && data.kind ? data.kind : "note";
    const merged: fm.Frontmatter = {
      ...data,
      title: data.title ?? slug,
      slug,
      kind,
      status: data.status ?? "active",
    };
    fs.writeFileSync(absPath, fm.stringify(content, merged));

    const meta: DocMeta = {
      slug,
      title: String(merged.title),
      kind,
      project: key,
      theme: typeof data.theme === "string" ? data.theme : undefined,
      status: String(merged.status),
      format,
      file: absPath,
      updatedAt: now,
    };
    upsertDoc(key, label, meta);
    return meta;
  }

  // html docs: index by filename, no frontmatter rewrite.
  const meta: DocMeta = {
    slug,
    title: slug,
    kind: "note",
    project: key,
    status: "active",
    format,
    file: absPath,
    updatedAt: now,
  };
  upsertDoc(key, label, meta);
  return meta;
}
