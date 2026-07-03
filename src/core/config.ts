import fs from "node:fs";
import path from "node:path";
import { configPath } from "./paths.js";
import type { Config } from "./types.js";

// Defaults written on first plan (ADR-0001 §D23).
export const DEFAULT_CONFIG: Config = {
  theme: "minimal",
  planFormat: "md",
  defaultTtlDays: 30,
  projects: {},
};

export function loadConfig(): Config {
  try {
    const raw = JSON.parse(fs.readFileSync(configPath(), "utf8"));
    return { ...DEFAULT_CONFIG, ...raw, projects: { ...raw.projects } };
  } catch {
    return structuredClone(DEFAULT_CONFIG);
  }
}

export function saveConfig(cfg: Config): void {
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(cfg, null, 2) + "\n");
}

/** Theme resolution order: plan > project > global (ADR-0001 §D8). */
export function resolveTheme(cfg: Config, projectKey: string, planTheme?: string): string {
  return planTheme ?? cfg.projects[projectKey]?.theme ?? cfg.theme;
}
