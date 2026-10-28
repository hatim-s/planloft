import fs from "node:fs";
import path from "node:path";
import { templatesDir } from "../core/paths.js";
import type { Manifest } from "./adapter.js";
import { assertAvailableSlug, assertPublicationSlug, migratedLanding } from "./urls.js";

function assertNoSymlinksDirectory(dir: string): void {
  const stat = fs.lstatSync(dir);
  if (stat.isSymbolicLink() || !stat.isDirectory()) invalid("Hosting root must be a directory, without symlinks.");
}

const metadata = new Set([
  "public", "manifest.json", "vercel.json", "package.json", "package-lock.json",
  "bun.lock", "pnpm-lock.yaml", "yarn.lock", "LICENSE", "LICENSE.md",
]);

function invalid(reason: string): never {
  throw new Error(`PLANLOFT_HOSTING_INVALID: ${reason}`);
}

export function assertNoSymlinks(file: string): void {
  const stat = fs.lstatSync(file);
  if (stat.isSymbolicLink()) invalid("Hosting files must not be symbolic links.");
  if (stat.isDirectory()) {
    for (const name of fs.readdirSync(file)) assertNoSymlinks(path.join(file, name));
  } else if (!stat.isFile()) invalid("Hosting files must be regular files or directories.");
}

export function readManifest(dir: string): Manifest {
  const file = path.join(dir, "manifest.json");
  assertNoSymlinks(file);
  const value: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
  if (typeof value !== "object" || value === null || !("version" in value) || value.version !== 1 ||
      !("deploys" in value) || !Array.isArray(value.deploys)) invalid("Expected a version-1 manifest with deploys.");
  const ids = new Set<string>();
  const documents = new Set<string>();
  for (const entry of value.deploys) {
    if (typeof entry !== "object" || entry === null) invalid("Invalid manifest entry.");
    for (const key of ["id", "project", "slug", "title", "kind"] as const) {
      if (typeof entry[key] !== "string" || !entry[key].trim()) invalid(`Invalid manifest ${key}.`);
    }
    if (!/^[A-Za-z0-9_-]+$/.test(entry.id) || ids.has(entry.id)) invalid("Unsafe or duplicate manifest id.");
    const document = JSON.stringify([entry.project, entry.slug]);
    if (documents.has(document)) invalid("Duplicate manifest document.");
    ids.add(entry.id);
    documents.add(document);
    for (const key of ["createdAt", "expiresAt"] as const) {
      if (key === "expiresAt" && entry[key] === null) continue;
      if (typeof entry[key] !== "string" || !Number.isFinite(Date.parse(entry[key]))) invalid(`Invalid manifest ${key}.`);
    }
  }
  // All manifest fields have been validated at the repository boundary.
  return value as Manifest;
}

export function writeManifest(dir: string, manifest: Manifest): void {
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
}

/** Move the legacy web root once, without rewriting document bytes or URLs. */
export function prepareHostingRepository(dir: string, candidate?: { project: string; slug: string; id: string }): { migrated: boolean } {
  const marker = path.join(dir, ".planloft", "layout.json");
  assertNoSymlinksDirectory(dir);
  for (const name of [".planloft", ".github", "public", "vercel.json", "manifest.json", ".gitignore", ".vercelignore"]) {
    const file = path.join(dir, name);
    if (fs.existsSync(file)) assertNoSymlinks(file);
    else {
      try { fs.lstatSync(file); invalid("Dangling hosting symlink."); }
      catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error; }
    }
  }
  const initialized = fs.existsSync(marker);
  const version = initialized ? JSON.parse(fs.readFileSync(marker, "utf8")).version : 1;
  if (![1, 2, 3].includes(version)) invalid("Unknown hosting layout version.");
  const hasManifest = fs.existsSync(path.join(dir, "manifest.json"));
  if (initialized && !hasManifest) invalid("Migrated hosting requires manifest.json.");
  const manifest = hasManifest ? readManifest(dir) : { version: 1 as const, deploys: [] };
  if (!hasManifest && fs.existsSync(path.join(dir, "p"))) invalid("Legacy plans require a readable manifest.json.");

  if (candidate) {
    if (!/^[A-Za-z0-9_-]+$/.test(candidate.id)) invalid("Unsafe publication id.");
    assertAvailableSlug(manifest, candidate.project, candidate.slug);
    if (!manifest.deploys.some(entry => entry.project === candidate.project && entry.slug === candidate.slug) && manifest.deploys.some(entry => entry.id === candidate.id)) invalid("Publication ID already exists. Retry deployment.");
  }
  const slugs = new Set<string>();
  for (const entry of manifest.deploys) {
    assertPublicationSlug(entry.slug);
    if (slugs.has(entry.slug)) invalid("Duplicate publication slug across projects.");
    slugs.add(entry.slug);
  }
  const moves = initialized ? [] : fs.readdirSync(dir).filter(name =>
    (!name.startsWith(".") || name === ".nojekyll") && !metadata.has(name) && !/\.md$/i.test(name),
  );
  for (const name of moves) {
    assertNoSymlinks(path.join(dir, name));
    if (fs.existsSync(path.join(dir, "public", name))) invalid("Legacy and public paths conflict. Resolve them before migrating.");
  }
  for (const entry of manifest.deploys) {
    const source = path.join(dir, initialized ? "public" : "", "p", entry.id, "index.html");
    if (!fs.existsSync(source)) invalid("Manifest references a missing plan index.html.");
    if (version === 3 && !fs.existsSync(path.join(dir, "public", entry.slug, "index.html"))) invalid("Manifest references a missing slug index.html.");
  }
  const publicRoot = path.join(dir, "public");
  const rootNames = new Set([
    ...(fs.existsSync(publicRoot) ? fs.readdirSync(publicRoot) : []),
    ...moves,
  ].map(name => name.toLowerCase()));
  for (const slug of [...slugs, ...(candidate && !slugs.has(candidate.slug) ? [candidate.slug] : [])]) {
    if (version < 3 && (rootNames.has(slug) || rootNames.has(`${slug}.html`))) invalid(`Publication slug ${slug} conflicts with an existing site path.`);
    if (version === 3 && !slugs.has(slug) && (rootNames.has(slug) || rootNames.has(`${slug}.html`))) invalid(`Publication slug ${slug} conflicts with an existing site path.`);
  }
  const vercelConfig = path.join(dir, "vercel.json");
  if (fs.existsSync(vercelConfig)) {
    const config = JSON.parse(fs.readFileSync(vercelConfig, "utf8"));
    if (config.outputDirectory !== "public" || config.framework !== null ||
        config.buildCommand !== "" || config.installCommand !== "") {
      invalid("Existing vercel.json conflicts with the static public/ layout.");
    }
  }

  fs.mkdirSync(path.join(dir, "public"), { recursive: true });
  for (const name of moves) fs.renameSync(path.join(dir, name), path.join(dir, "public", name));
  if (version < 3) {
    for (const entry of manifest.deploys) {
      const landing = path.join(dir, "public", entry.slug);
      fs.mkdirSync(landing, { recursive: true });
      fs.writeFileSync(path.join(landing, "index.html"), migratedLanding(entry.id));
    }
  }
  fs.mkdirSync(path.dirname(marker), { recursive: true });
  if (!hasManifest) writeManifest(dir, manifest);
  const tpl = path.join(templatesDir(), "hosting");
  for (const [source, target] of [
    ["vercel.json", "vercel.json"],
    ["pages.yml", ".github/workflows/planloft-pages.yml"],
    ["prune-plans.yml", ".github/workflows/prune-plans.yml"],
    ["prune.mjs", ".planloft/prune.mjs"],
  ]) {
    const file = path.join(dir, target!);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (!initialized || !fs.existsSync(file) || (version < 3 && source === "prune.mjs")) fs.copyFileSync(path.join(tpl, source!), file);
  }
  const index = path.join(dir, "public", "index.html");
  if (!fs.existsSync(index)) fs.writeFileSync(index, '<!doctype html><meta name="robots" content="noindex, nofollow"><title>planloft</title>\n');
  fs.writeFileSync(path.join(dir, "public", ".nojekyll"), "");
  for (const name of [".gitignore", ".vercelignore"]) {
    const file = path.join(dir, name);
    const contents = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
    const missing = [".vercel", ".env*"].filter(pattern => !contents.split(/\r?\n/).includes(pattern));
    if (missing.length) fs.writeFileSync(file, `${contents}${contents && !contents.endsWith("\n") ? "\n" : ""}${missing.join("\n")}\n`);
  }
  // Existing index generators read repository metadata but now write to public/.
  const generator = path.join(dir, ".planloft", "update-indexes.mjs");
  if (!initialized && fs.existsSync(generator)) {
    const script = fs.readFileSync(generator, "utf8")
      .replaceAll('path.join(root, "index.html")', 'path.join(root, "public", "index.html")')
      .replaceAll("Planloft / GitHub Pages", "Planloft")
      .replaceAll("Plans currently available on GitHub Pages.", "Published plans and documents.");
    fs.writeFileSync(generator, script);
  }
  fs.writeFileSync(marker, '{"version":3}\n');
  return { migrated: version < 3 };
}
