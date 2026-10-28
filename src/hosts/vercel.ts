import { execFileSync } from "node:child_process";
import type { Config } from "../core/types.js";
import type { HostAdapter } from "./adapter.js";
import { publishRepository } from "./repository.js";

export function vercelSettings(cfg: Config) {
  const project = cfg.vercel?.project ?? cfg.github?.repo ?? "planloft-plans";
  if (!/^[a-z0-9][a-z0-9-]{0,99}$/.test(project)) {
    throw new Error("PLANLOFT_VERCEL_CONFIG_INVALID: Set vercel.project to a lowercase project name.");
  }
  let url: URL;
  try { url = new URL(cfg.vercel?.url ?? `https://${project}.vercel.app`); }
  catch { throw new Error("PLANLOFT_VERCEL_CONFIG_INVALID: vercel.url must be an HTTPS origin."); }
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash || url.port) {
    throw new Error("PLANLOFT_VERCEL_CONFIG_INVALID: vercel.url must be an HTTPS origin.");
  }
  return { project, origin: url.origin, domain: url.hostname, scope: cfg.vercel?.scope };
}

export function runVercel(
  args: string[], cfg: Config, cwd?: string,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const env: NodeJS.ProcessEnv = { ...process.env, ...environment, NO_COLOR: "1", VERCEL_TELEMETRY_DISABLED: "1" };
  // Ambient project selectors must not redirect a deploy away from this repository.
  delete env.VERCEL_PROJECT_ID;
  delete env.VERCEL_ORG_ID;
  const token = environment.VERCEL_TOKEN?.trim() || cfg.vercel?.token;
  if (token) env.VERCEL_TOKEN = token;
  try {
    return execFileSync("vercel", [...args, ...(cfg.vercel?.scope ? ["--scope", cfg.vercel.scope] : [])], {
      cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch {
    throw new Error("PLANLOFT_VERCEL_FAILED: Install the Vercel CLI, run vercel login, and check project permissions. If Git was pushed, the repository change remains saved; retry the deploy.");
  }
}

export const vercel: HostAdapter = {
  name: "vercel",
  basePath(id) { return `/${id}/`; },
  async deploy(input) {
    const settings = vercelSettings(input.cfg);
    // Authenticate before creating or updating the backing GitHub repository.
    runVercel(["whoami"], input.cfg, undefined, input.environment);
    const { dir, expiresAt, pagesWarning } = await publishRepository(input, settings.origin);
    runVercel(["link", "--yes", "--project", settings.project], input.cfg, dir, input.environment);
    const output = runVercel(["deploy", "--prod", "--yes", "--json"], input.cfg, dir, input.environment);
    const result: unknown = JSON.parse(output);
    if (typeof result !== "object" || result === null || !("status" in result) || result.status !== "ok" ||
        !("deployment" in result) || typeof result.deployment !== "object" || result.deployment === null ||
        !("url" in result.deployment) || typeof result.deployment.url !== "string" ||
        !("readyState" in result.deployment) || result.deployment.readyState !== "READY" ||
        !/^https:\/\/[a-zA-Z0-9.-]+\.vercel\.app\/?$/.test(result.deployment.url)) {
      throw new Error("PLANLOFT_VERCEL_FAILED: Vercel returned no ready deployment. The Git push may already have succeeded.");
    }
    const deploymentUrl = result.deployment.url;
    runVercel(["alias", "set", deploymentUrl, settings.domain], input.cfg, dir, input.environment);
    return { url: `${settings.origin}/${input.doc.slug}/`, expiresAt, ...(pagesWarning ? { warnings: [pagesWarning] } : {}) };
  },
};
