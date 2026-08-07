import fs from "node:fs";
import path from "node:path";
import { ensureConfig, resolveTheme } from "./config.js";
import { docDir, docFile } from "./doc.js";
import { projectKey } from "./project.js";
import { getDoc, upsertDoc } from "./store.js";
import * as fm from "./frontmatter.js";
import type { CanonicalDocument, DocMeta } from "./types.js";

export interface HoistOptions {
  cwd?: string;
}

/** Persist a canonical document in the current project's store and index it. */
export function hoistDocument(doc: CanonicalDocument, options: HoistOptions = {}): DocMeta {
  const cfg = ensureConfig();
  const { key, label } = projectKey(options.cwd);
  resolveTheme(cfg, key, doc.theme);
  const format = doc.contentFormat;
  const file = docFile(label, doc.slug, format);
  const previous = getDoc(key, doc.slug);

  fs.mkdirSync(docDir(label), { recursive: true });
  if (previous?.file !== file && previous?.file && fs.existsSync(previous.file)) {
    fs.rmSync(previous.file);
  }

  const frontmatter: fm.Frontmatter = {
    title: doc.title,
    slug: doc.slug,
    kind: doc.kind,
    status: doc.status,
  };
  if (doc.theme) frontmatter.theme = doc.theme;
  const source = format === "md" ? fm.stringify(doc.content, frontmatter) : doc.content;
  fs.writeFileSync(file, source);

  const meta: DocMeta = {
    slug: doc.slug,
    title: doc.title,
    kind: doc.kind,
    project: key,
    theme: doc.theme,
    status: doc.status,
    format,
    trustedHtml: doc.trustedHtml,
    file: path.resolve(file),
    updatedAt: new Date().toISOString(),
  };
  upsertDoc(key, label, meta);
  return meta;
}
