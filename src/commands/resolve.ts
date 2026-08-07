import fs from "node:fs";
import { ensureConfig, resolveTheme } from "../core/config.js";
import { projectKey } from "../core/project.js";
import { docDir, docFile } from "../core/doc.js";
import { slugify } from "../core/slug.js";
import { ensureProject, loadIndex, saveIndex } from "../core/store.js";
import { readTemplate } from "../render/themes.js";
import type { Kind, ResolvedContext } from "../core/types.js";

/**
 * Print the target path + resolved kind/theme/format/template for the current project.
 * Consumed by the write-plan skill (ADR-0008). Zero-config writes defaults on first use.
 */
export function resolve(opts: { slug?: string; title?: string; kind?: string }): void {
  const cfg = ensureConfig();

  const { key, label } = projectKey();
  const kind: Kind = opts.kind || "plan";
  const title = opts.title ?? opts.slug ?? capitalize(kind);
  const slug = slugify(opts.slug ?? title);
  const theme = resolveTheme(cfg, key);
  // Write-direct agent capture always authors Markdown. Explicit trusted HTML remains
  // available through render, hoist, and publish instead of through resolve.
  const format = "md" as const;

  // Register the project bucket + ensure its dir exists.
  const idx = loadIndex();
  ensureProject(idx, key, label);
  saveIndex(idx);
  fs.mkdirSync(docDir(label), { recursive: true });

  const out: ResolvedContext = {
    path: docFile(label, slug, format),
    kind,
    format,
    theme,
    template: readTemplate(theme),
  };
  process.stdout.write(JSON.stringify(out, null, 2) + "\n");
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
