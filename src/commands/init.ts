import fs from "node:fs";
import pc from "picocolors";
import { configPath } from "../core/paths.js";
import { ensureConfig, loadConfig } from "../core/config.js";
import { hasGh } from "../hosts/github-pages.js";

/** Optional setup (ADR-0001 §D23): ensure config exists + report GitHub readiness. */
export function init(): void {
  let absent = false;
  try {
    fs.statSync(configPath());
  } catch (error) {
    absent = (error as NodeJS.ErrnoException).code === "ENOENT";
  }
  const cfg = absent ? ensureConfig() : loadConfig();
  if (absent) {
    console.log(pc.green("Wrote default config: ") + configPath());
  } else {
    console.log(pc.dim("Config exists: ") + configPath());
  }
  console.log(`theme=${cfg.theme}  planFormat=${cfg.planFormat}  defaultTtlDays=${cfg.defaultTtlDays}`);

  const repo = cfg.github?.repo ?? "planloft-plans";
  console.log(
    "github (gh) : " +
      (hasGh()
        ? pc.green("ready (preferred credential)")
        : pc.yellow(
            "not ready — deploy next checks PLANLOFT_GITHUB_TOKEN, github.token, then a TTY-only prompt",
          )) +
      pc.dim(`  repo=${repo}`),
  );
}
