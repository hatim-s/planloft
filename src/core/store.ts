import fs from "node:fs";
import path from "node:path";
import { indexPath } from "./paths.js";
import type { DocMeta, IndexFile, ProjectEntry } from "./types.js";

export function loadIndex(): IndexFile {
  try {
    return JSON.parse(fs.readFileSync(indexPath(), "utf8")) as IndexFile;
  } catch {
    return { version: 1, projects: {} };
  }
}

export function saveIndex(idx: IndexFile): void {
  fs.mkdirSync(path.dirname(indexPath()), { recursive: true });
  fs.writeFileSync(indexPath(), JSON.stringify(idx, null, 2) + "\n");
}

export function ensureProject(idx: IndexFile, key: string, label: string): ProjectEntry {
  const existing = idx.projects[key];
  if (existing) return existing;
  const entry: ProjectEntry = { key, label, dir: label, docs: {} };
  idx.projects[key] = entry;
  return entry;
}

export function upsertDoc(key: string, label: string, meta: DocMeta): void {
  const idx = loadIndex();
  ensureProject(idx, key, label).docs[meta.slug] = meta;
  saveIndex(idx);
}

export function getDoc(key: string, slug: string): DocMeta | undefined {
  return loadIndex().projects[key]?.docs[slug];
}

export function latestDoc(key: string): DocMeta | undefined {
  const docs = Object.values(loadIndex().projects[key]?.docs ?? {});
  return docs.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
}

export function removeDoc(key: string, slug: string): DocMeta | undefined {
  const idx = loadIndex();
  const entry = idx.projects[key];
  const meta = entry?.docs[slug];
  if (entry && meta) {
    delete entry.docs[slug];
    saveIndex(idx);
  }
  return meta;
}
