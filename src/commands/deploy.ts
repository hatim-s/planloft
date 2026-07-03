import pc from "picocolors";
import { projectKey } from "../core/project.js";
import { getDoc, latestDoc } from "../core/store.js";
import { loadConfig, resolveTheme } from "../core/config.js";
import { buildSite } from "../render/renderer.js";
import { shortId } from "../core/id.js";
import { getAdapter } from "../hosts/adapter.js";

export interface DeployFlags {
  host?: string;
  ttl?: number;
  comments?: boolean;
}

/** Build + publish a single plan as a shareable review link (ADR-0001 §D11, §D14). */
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
  const host = flags.host ?? "github";
  const adapter = getAdapter(host);
  if (!adapter) {
    console.error(pc.red(`Unknown host '${host}'. Known: github, vercel.`));
    process.exitCode = 1;
    return;
  }

  // Vercel is permanent; GitHub Pages carries a TTL (ADR-0001 §D11, §D20).
  const ttlDays = host === "vercel" ? undefined : flags.ttl ?? cfg.defaultTtlDays;
  const id = shortId();
  const base = adapter.basePath(id);
  const dist = buildSite({ doc: meta, theme, base, comments: flags.comments, noindex: true });

  try {
    const url = await adapter.deploy({ id, dist, doc: meta, ttlDays, cfg });
    console.log(pc.green("Deployed: ") + url);
    if (ttlDays) console.log(pc.dim(`Expires in ${ttlDays} days (redeploy to bump).`));
  } catch (err) {
    console.error(pc.red("Deploy failed: ") + (err as Error).message);
    process.exitCode = 1;
  }
}
