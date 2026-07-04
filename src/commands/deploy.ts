import pc from "picocolors";
import { projectKey } from "../core/project.js";
import { getDoc, latestDoc } from "../core/store.js";
import { loadConfig, resolveTheme } from "../core/config.js";
import { buildSite } from "../render/renderer.js";
import { shortId } from "../core/id.js";
import { getAdapter } from "../hosts/adapter.js";

export interface DeployFlags {
  ttl?: number;
  comments?: boolean;
}

/**
 * Build + publish a single doc as a shareable review link.
 * GitHub Pages only for now (ADR-0006); Vercel/CF Workers are deferred. The pluggable
 * HostAdapter seam remains so they can be re-enabled later.
 */
export async function deploy(slug: string | undefined, flags: DeployFlags): Promise<void> {
  const { key } = projectKey();
  const meta = slug ? getDoc(key, slug) : latestDoc(key);
  if (!meta) {
    console.error(pc.red("No matching doc to deploy."));
    process.exitCode = 1;
    return;
  }

  const cfg = loadConfig();
  const theme = resolveTheme(cfg, key, meta.theme);
  const adapter = getAdapter("github")!; // always registered

  const ttlDays = flags.ttl ?? cfg.defaultTtlDays;
  const id = shortId();
  const base = adapter.basePath(id);
  const dist = buildSite({ doc: meta, theme, base, comments: flags.comments, noindex: true });

  try {
    const url = await adapter.deploy({ id, dist, doc: meta, ttlDays, cfg });
    console.log(pc.green("Deployed: ") + url);
    console.log(pc.dim(`Expires in ${ttlDays} days (redeploy to bump).`));
    console.log(pc.dim("GitHub Pages can take ~1 min to build on first deploy."));
  } catch (err) {
    console.error(pc.red("Deploy failed: ") + (err as Error).message);
    process.exitCode = 1;
  }
}
