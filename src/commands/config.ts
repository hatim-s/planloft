import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { configPath } from "../core/paths.js";
import { DEFAULT_CONFIG, loadConfig, saveConfig } from "../core/config.js";

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
  console.log(JSON.stringify(loadConfig(), null, 2));
}
