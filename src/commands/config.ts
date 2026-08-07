import { execFileSync } from "node:child_process";
import { configPath } from "../core/paths.js";
import { ensureConfig, loadConfig } from "../core/config.js";
import type { Config } from "../core/types.js";

/** Open the global config in $EDITOR (falls back to printing it). */
export function config(): void {
  ensureConfig();
  const editor = process.env.EDITOR || process.env.VISUAL;
  if (editor) {
    execFileSync(editor, [configPath()], { stdio: "inherit" });
    loadConfig();
    return;
  }
  console.log(configPath());
  const cfg = loadConfig();
  console.log(JSON.stringify(redactConfig(cfg), null, 2));
}

export function redactConfig(cfg: Config): Config {
  return cfg.github?.token
    ? { ...cfg, github: { ...cfg.github, token: "[redacted]" } }
    : cfg;
}
