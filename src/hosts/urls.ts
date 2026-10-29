import type { Manifest } from "./adapter.js";

const reserved = new Set(["p", "api", "assets", "gallery", "index", "public", "manifest", "favicon", "robots", "sitemap", "404"]);

export function assertPublicationSlug(slug: string): void {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 120 || reserved.has(slug)) {
    throw new Error("PLANLOFT_HOSTING_INVALID: Use a unique lowercase hyphenated slug, at most 120 characters, outside reserved site paths.");
  }
}

export function assertAvailableSlug(manifest: Manifest, project: string, slug: string): void {
  assertPublicationSlug(slug);
  if (manifest.deploys.some(entry => entry.slug === slug && entry.project !== project)) {
    throw new Error("PLANLOFT_HOSTING_INVALID: Another project already publishes this slug. Choose a different slug before deploying.");
  }
}

export function legacyRedirect(slug: string): string {
  assertPublicationSlug(slug);
  // Relative to /p/<id>/ so GitHub Pages repository prefixes are retained.
  return `<!doctype html><meta charset="utf-8"><meta name="robots" content="noindex"><meta http-equiv="refresh" content="0;url=../../${slug}/"><title>Document moved</title><a href="../../${slug}/">Open document</a>\n`;
}

export function migratedLanding(id: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error("PLANLOFT_HOSTING_INVALID: Unsafe publication id.");
  // Keep legacy documents at their original base until they are rendered again.
  return `<!doctype html><meta charset="utf-8"><meta name="robots" content="noindex"><meta http-equiv="refresh" content="0;url=../p/${id}/"><title>Open document</title><a href="../p/${id}/">Open document</a>\n`;
}
