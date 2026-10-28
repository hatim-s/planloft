import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Config } from "../core/types.js";
import type { HostAdapter } from "./adapter.js";
import { publishRepository } from "./repository.js";

export function cloudflareSettings(cfg: Config) {
  const { worker, accountId, url } = cfg.cloudflare ?? {};
  if (!worker || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(worker) || !accountId || !/^[a-fA-F0-9]{32}$/.test(accountId) || !url) {
    throw new Error("PLANLOFT_CLOUDFLARE_CONFIG_INVALID: Set cloudflare.worker, accountId and the stable workers.dev URL.");
  }
  let origin: URL;
  try { origin = new URL(url); } catch { throw new Error("PLANLOFT_CLOUDFLARE_CONFIG_INVALID: cloudflare.url must be the worker's HTTPS workers.dev origin."); }
  if (origin.protocol !== "https:" || origin.username || origin.password || origin.port || origin.pathname !== "/" || origin.search || origin.hash || !origin.hostname.startsWith(`${worker}.`) || !origin.hostname.endsWith(".workers.dev")) {
    throw new Error("PLANLOFT_CLOUDFLARE_CONFIG_INVALID: cloudflare.url must be the worker's HTTPS workers.dev origin.");
  }
  return { worker, accountId, origin: origin.origin };
}

function runWrangler(args: string[], accountId: string, cwd: string | undefined, environment: Readonly<Record<string, string | undefined>> = process.env) {
  try {
    execFileSync("wrangler", args, { cwd, env: { ...process.env, ...environment, CLOUDFLARE_ACCOUNT_ID: accountId }, stdio: ["ignore", "pipe", "pipe"] });
  } catch {
    throw new Error("PLANLOFT_CLOUDFLARE_FAILED: Install Wrangler and log in or set CLOUDFLARE_API_TOKEN. The Git push may have succeeded; retry deploy.");
  }
}

export function verifyCloudflareDeployment(output: string, worker: string, origin: string): void {
  const fail = () => new Error("PLANLOFT_CLOUDFLARE_FAILED: Wrangler did not confirm the configured worker URL. Deployment and Git push may have succeeded; correct cloudflare.url and retry.");
  try {
    const records: unknown[] = output.split(/\r?\n/).filter(line => line.trim()).map(line => JSON.parse(line));
    const deployed = records.filter(record => typeof record === "object" && record !== null && "type" in record && record.type === "deploy");
    if (deployed.length !== 1) throw fail();
    const record = deployed[0]!;
    if (typeof record !== "object" || record === null) throw fail();
    if (!("version" in record) || record.version !== 1 || !("worker_name" in record) || record.worker_name !== worker || !("targets" in record) || !Array.isArray(record.targets) || !record.targets.includes(origin)) throw fail();
  } catch { throw fail(); }
}

export const cloudflare: HostAdapter = {
  name: "cloudflare",
  basePath(slug) { return `/${slug}/`; },
  async deploy(input) {
    const settings = cloudflareSettings(input.cfg);
    runWrangler(["whoami"], settings.accountId, undefined, input.environment);
    const { dir, expiresAt, pagesWarning } = await publishRepository(input, settings.origin);
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "planloft-wrangler-"));
    try {
      const config = path.join(temp, "wrangler.json");
      fs.writeFileSync(config, JSON.stringify({ name: settings.worker, account_id: settings.accountId, compatibility_date: "2025-01-01", workers_dev: true, assets: { directory: path.join(dir, "public") } }));
      const output = path.join(temp, "deploy.jsonl");
      runWrangler(["deploy", "--config", config], settings.accountId, dir, { ...input.environment, WRANGLER_OUTPUT_FILE_PATH: output });
      verifyCloudflareDeployment(fs.existsSync(output) ? fs.readFileSync(output, "utf8") : "", settings.worker, settings.origin);
    } finally {
      fs.rmSync(temp, { recursive: true, force: true });
    }
    return { url: `${settings.origin}/${input.doc.slug}/`, expiresAt, ...(pagesWarning ? { warnings: [pagesWarning] } : {}) };
  },
};
