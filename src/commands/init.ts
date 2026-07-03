import fs from "node:fs";
import pc from "picocolors";
import { configPath } from "../core/paths.js";
import { DEFAULT_CONFIG, loadConfig, saveConfig } from "../core/config.js";
import { hasGh } from "../hosts/github-pages.js";
import { hasVercel } from "../hosts/vercel.js";

/** Optional setup (ADR-0001 §D23): ensure config exists + report host readiness. */
export function init(): void {
  if (!fs.existsSync(configPath())) {
    saveConfig(DEFAULT_CONFIG);
    console.log(pc.green("Wrote default config: ") + configPath());
  } else {
    console.log(pc.dim("Config exists: ") + configPath());
  }

  const cfg = loadConfig();
  console.log(`theme=${cfg.theme}  planFormat=${cfg.planFormat}  defaultTtlDays=${cfg.defaultTtlDays}`);
  console.log(
    "github (gh) : " +
      (hasGh() ? pc.green("ready") : pc.yellow("not found — will prompt for a PAT on deploy")),
  );
  console.log(
    "vercel      : " +
      (hasVercel() ? pc.green("ready") : pc.yellow("not found — will prompt for a token on --host vercel")),
  );
}
