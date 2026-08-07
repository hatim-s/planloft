import type { Config, DocMeta } from "../core/types.js";
import { githubPages } from "./github-pages.js";
import { vercel } from "./vercel.js";

export interface DeployInput {
  id: string;
  dist: string; // built site directory
  doc: DocMeta;
  ttlDays: number;
  cfg: Config;
}

export interface DeployResult {
  url: string;
  expiresAt: string;
}

/** Pluggable host interface (ADR-0001 §D11). Add Cloudflare/Netlify by implementing this. */
export interface HostAdapter {
  name: string;
  /** URL base path to build the site with, e.g. "/planloft-plans/p/<id>/". */
  basePath(id: string): string;
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
