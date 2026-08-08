import path from "node:path";
import { docsDir } from "./paths.js";
import type { Kind, PlanFormat } from "./types.js";

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
