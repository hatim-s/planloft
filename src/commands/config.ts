import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { configPath } from "../core/paths.js";
import { DEFAULT_CONFIG, loadConfig, saveConfig } from "../core/config.js";
import type { Config } from "../core/types.js";

/** Open the global config in $EDITOR (falls back to printing it). */
export function config(): void {
  if (!fs.existsSync(configPath())) saveConfig(DEFAULT_CONFIG);
  const editor = process.env.EDITOR || process.env.VISUAL;
  if (editor) {
    try {
      execFileSync(editor, [configPath()], { stdio: "inherit" });
      return;
    } catch {
      /* fall through to print */
    }
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
