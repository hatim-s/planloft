import fs from "node:fs";
import path from "node:path";
import { configPath } from "./paths.js";
import type { Config } from "./types.js";
import { parseTtlDays } from "./ttl.js";

// Defaults written on first plan (ADR-0001 §D23).
export const DEFAULT_CONFIG: Config = {
  theme: "minimal",
  planFormat: "md",
  defaultTtlDays: 30,
  projects: {},
};

export function loadConfig(): Config {
  let raw: Partial<Config>;
  try {
    raw = JSON.parse(fs.readFileSync(configPath(), "utf8")) as Partial<Config>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return structuredClone(DEFAULT_CONFIG);
  }
  const merged = { ...DEFAULT_CONFIG, ...raw, projects: { ...raw.projects } };
  merged.defaultTtlDays = parseTtlDays(merged.defaultTtlDays, "config.defaultTtlDays");
  return merged;
}

export function saveConfig(cfg: Config): void {
  parseTtlDays(cfg.defaultTtlDays, "config.defaultTtlDays");
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(cfg, null, 2) + "\n");
}

/** Theme resolution order: plan > project > global (ADR-0001 §D8). */
export function resolveTheme(cfg: Config, projectKey: string, planTheme?: string): string {
  return planTheme ?? cfg.projects[projectKey]?.theme ?? cfg.theme;
}
