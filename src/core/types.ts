// Shared types for the planloft store. See docs/adr/ for the decisions behind these.

export type PlanFormat = "md" | "html";

// Document kinds (ADR-0002). Built-ins are first-class; any string is also accepted.
export type BuiltinKind = "plan" | "adr" | "review" | "research" | "report" | "note";
// eslint-disable-next-line @typescript-eslint/ban-types
export type Kind = BuiltinKind | (string & {});

/** Metadata for one document, mirrored into index.json (ADR-0001 §D3, §D5; ADR-0002). */
export interface DocMeta {
  slug: string;
  title: string;
  kind: Kind; // ADR-0002: organizational tag (plan | adr | review | research | report | note | …)
  project: string; // canonical project key (ADR-0001 §D4)
  theme?: string; // per-doc override (ADR-0001 §D8)
  status?: string; // draft | active | superseded | done
  format: PlanFormat;
  file: string; // absolute path in the store
  updatedAt: string; // ISO timestamp
}

/** One project bucket in the index. Docs are flat per project, keyed by slug (ADR-0002). */
export interface ProjectEntry {
  key: string; // canonical key (git remote or path-hash)
  label: string; // human folder label under docs/
  dir: string; // relative dir under docs/
  docs: Record<string, DocMeta>; // slug -> meta
}

/** ~/.planloft/config.json (ADR-0001 §D3, §D8, §D9, §D20). */
export interface Config {
  theme: string; // global default theme
  planFormat: PlanFormat; // md | html
  defaultTtlDays: number; // GitHub Pages TTL default
  projects: Record<string, { theme?: string }>; // key -> per-project overrides
  github?: { token?: string; user?: string; repo?: string };
  vercel?: { token?: string };
}

/** ~/.planloft/index.json */
export interface IndexFile {
  version: 1;
  projects: Record<string, ProjectEntry>; // key -> entry
}

/** Output of `planloft resolve`, consumed by the capture skills (ADR-0001 §D2; ADR-0002). */
export interface ResolvedContext {
  path: string;
  kind: Kind;
  format: PlanFormat;
  theme: string;
  template: string;
}
