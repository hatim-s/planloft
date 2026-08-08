import type { Config, DocMeta } from "../core/types.js";

export interface HostAuthentication {
  token: string;
  user: string;
}

export interface ManifestEntry {
  id: string;
  project: string;
  slug: string;
  title: string;
  kind: string;
  createdAt: string;
  expiresAt: string | null;
}

export interface Manifest {
  version: 1;
  deploys: ManifestEntry[];
}
import { githubPages } from "./github-pages.js";
import { vercel } from "./vercel.js";

export interface DeployInput {
  id: string;
  doc: DocMeta;
  ttlDays: number;
  cfg: Config;
  /** The application clock captured before effects begin. */
  now: Date;
  authentication: HostAuthentication;
  updateManifest(manifest: Manifest, candidateId: string): string;
  render(id: string): string;
}

export interface DeployResult {
  url: string;
  expiresAt: string;
  warnings?: string[];
}

/** Pluggable host interface (ADR-0001 §D11). Add Cloudflare/Netlify by implementing this. */
export interface HostAdapter {
  name: string;
  /** URL base path to build the site with, e.g. "/planloft-plans/p/<id>/". */
  basePath(id: string, cfg: Config): string;
  /** Publish the built dist and return the public URL. */
  deploy(input: DeployInput): Promise<DeployResult>;
}

const registry: Record<string, HostAdapter> = {
  github: githubPages,
  "github-pages": githubPages,
  vercel,
};

export function getAdapter(name: string): HostAdapter | undefined {
  return registry[name];
}
