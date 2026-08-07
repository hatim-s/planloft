import fs from "node:fs";
import pc from "picocolors";
import { configPath } from "../core/paths.js";
import { DEFAULT_CONFIG, loadConfig, saveConfig } from "../core/config.js";
import { hasGh } from "../hosts/github-pages.js";

/** Optional setup (ADR-0001 §D23): ensure config exists + report GitHub readiness. */
export function init(): void {
  if (!fs.existsSync(configPath())) {
    saveConfig(DEFAULT_CONFIG);
    console.log(pc.green("Wrote default config: ") + configPath());
  } else {
    console.log(pc.dim("Config exists: ") + configPath());
  }

  const cfg = loadConfig();
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
