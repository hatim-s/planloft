import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { configPath } from "./core/paths.js";
import type { Config } from "./core/types.js";
import { MAX_TTL_DAYS, TTL_RULE } from "./core/ttl.js";
import { assertThemeName, readTemplate, validateTheme } from "./render/themes.js";

export interface ResolvedProjectConfiguration {
  config: Config;
  theme: string;
}

interface GiscusCoordinates {
  repo: string;
  repoId: string;
  category: string;
  categoryId: string;
}

export interface RedactedConfiguration {
  version: 1;
  theme: string;
  defaultTtlDays: number;
  projects: Record<string, { theme?: string; giscus?: Partial<GiscusCoordinates> }>;
  giscus?: Partial<GiscusCoordinates>;
  github?: { token?: "[redacted]"; user?: string; repo?: string };
  vercel?: { token?: "[redacted]" };
}

export interface PlanloftConfiguration {
  load(): Config;
  ensure(): Config;
  save(config: Config): void;
  update(patch: ConfigPatch): Config;
  resolveProject(projectKey: string, documentTheme?: string): ResolvedProjectConfiguration;
  resolveAuthoring(projectKey: string): ResolvedProjectConfiguration & { template: string };
  redact(config?: Config): RedactedConfiguration;
}

/**
 * The single configuration interface used by application, persistence, rendering,
 * publication, and tests. Parsing and storage remain private implementation details.
 */
export function createPlanloftConfiguration(): PlanloftConfiguration {
  return {
    load: loadConfig,
    ensure: ensureConfig,
    save: saveConfig,
    update: updateConfig,
    resolveProject(projectKey, documentTheme) {
      const config = loadConfig();
      return { config, theme: resolveTheme(config, projectKey, documentTheme) };
    },
    resolveAuthoring(projectKey) {
      const resolved = this.resolveProject(projectKey);
      return { ...resolved, template: readTemplate(resolved.theme) };
    },
    redact(config = loadConfig()) {
      return redactConfig(config);
    },
  };
}

export function redactConfig(config: Config): RedactedConfiguration {
  const { github: _github, vercel: _vercel, ...visibleConfig } = config;
  const github = config.github
    ? (({ token: _token, ...visible }) => ({
        ...visible,
        ...(config.github?.token === undefined ? {} : { token: "[redacted]" as const }),
      }))(config.github)
    : undefined;
  const vercel = config.vercel
    ? { ...(config.vercel.token === undefined ? {} : { token: "[redacted]" as const }) }
    : undefined;
  return {
    ...visibleConfig,
    ...(github ? { github } : {}),
    ...(vercel ? { vercel } : {}),
  };
}

export type ConfigDiagnosticCode =
  | "PLANLOFT_CONFIG_MALFORMED"
  | "PLANLOFT_CONFIG_INACCESSIBLE"
  | "PLANLOFT_CONFIG_INVALID"
  | "PLANLOFT_CONFIG_MIGRATION_REQUIRED";

export class ConfigError extends Error {
  constructor(
    readonly code: ConfigDiagnosticCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(`[${code}] ${message}`, options);
    this.name = "ConfigError";
  }
}

// Defaults written on first plan (ADR-0001 §D23).
export const DEFAULT_CONFIG: Config = {
  version: 1,
  theme: "minimal",
  defaultTtlDays: 30,
  projects: {},
};

export function loadConfig(): Config {
  return readConfig().config;
}

/** Load the config and persist defaults only when the file is genuinely absent. */
export function ensureConfig(): Config {
  const result = readConfig();
  if (result.absent) saveConfig(result.config);
  return result.config;
}

function readConfig(): { config: Config; absent: boolean } {
  const file = configPath();
  let source: string;
  try {
    source = fs.readFileSync(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      try {
        fs.lstatSync(file);
      } catch (inspectionError) {
        if ((inspectionError as NodeJS.ErrnoException).code === "ENOENT") {
          return { config: structuredClone(DEFAULT_CONFIG), absent: true };
        }
        throw new ConfigError(
          "PLANLOFT_CONFIG_INACCESSIBLE",
          `Cannot inspect configuration at ${file}.`,
          { cause: inspectionError },
        );
      }
    }
    throw new ConfigError(
      "PLANLOFT_CONFIG_INACCESSIBLE",
      `Cannot read configuration at ${file}.`,
      { cause: error },
    );
  }

  let raw: unknown;
  try {
    raw = JSON.parse(source);
  } catch (error) {
    throw new ConfigError(
      "PLANLOFT_CONFIG_MALFORMED",
      `Configuration at ${file} is not valid JSON.`,
      { cause: error },
    );
  }

  return { config: validateConfig(raw, file), absent: false };
}

export function saveConfig(cfg: Config): void {
  const validated = validateConfig(cfg, "configuration to save");
  const file = configPath();
  const directory = path.dirname(file);
  const temporary = path.join(directory, `.${path.basename(file)}.${process.pid}.${randomUUID()}.tmp`);
  try {
    fs.mkdirSync(directory, { recursive: true });
    assertConfigIsNotDanglingSymlink(file);
    fs.writeFileSync(temporary, JSON.stringify(validated, null, 2) + "\n", {
      flag: "wx",
      mode: 0o600,
    });
    fs.renameSync(temporary, file);
  } catch (error) {
    try {
      fs.unlinkSync(temporary);
    } catch {
      // Preserve the primary write failure. A same-directory temp file can be
      // identified by its deliberately narrow name if manual cleanup is needed.
    }
    throw new ConfigError(
      "PLANLOFT_CONFIG_INACCESSIBLE",
      `Cannot atomically write configuration at ${file}.`,
      { cause: error },
    );
  }
}

export type ConfigPatch = Partial<Omit<Config, "version" | "projects" | "giscus" | "github" | "vercel">> & {
  projects?: Config["projects"];
  giscus?: NonNullable<Config["giscus"]>;
  github?: NonNullable<Config["github"]>;
  vercel?: NonNullable<Config["vercel"]>;
};

/** Apply a targeted update without discarding other valid configuration fields. */
export function updateConfig(patch: ConfigPatch): Config {
  const current = loadConfig();
  const projects = { ...current.projects };
  for (const [key, projectPatch] of Object.entries(patch.projects ?? {})) {
    if (projectPatch === undefined) continue;
    const giscusUpdate = optionalNestedUpdate(
      "giscus",
      projects[key]?.giscus,
      projectPatch.giscus,
    );
    if (
      projects[key] === undefined &&
      projectPatch.theme === undefined &&
      Object.keys(giscusUpdate).length === 0
    ) {
      continue;
    }
    projects[key] = {
      ...projects[key],
      ...(projectPatch.theme === undefined ? {} : { theme: projectPatch.theme }),
      ...giscusUpdate,
    };
  }
  const next: Config = {
    ...current,
    version: 1,
    projects,
    ...(patch.theme === undefined ? {} : { theme: patch.theme }),
    ...(patch.defaultTtlDays === undefined ? {} : { defaultTtlDays: patch.defaultTtlDays }),
    ...optionalNestedUpdate("giscus", current.giscus, patch.giscus),
    ...optionalNestedUpdate("github", current.github, patch.github),
    ...optionalNestedUpdate("vercel", current.vercel, patch.vercel),
  };
  const validated = validateConfig(next, "configuration update");
  saveConfig(validated);
  return validated;
}

export function validateConfig(value: unknown, source = "configuration"): Config {
  try {
    return validateConfigValue(value);
  } catch (error) {
    if (error instanceof ConfigError) throw error;
    throw new ConfigError(
      "PLANLOFT_CONFIG_INVALID",
      `${capitalize(source)} is semantically invalid: ${(error as Error).message}`,
      { cause: error },
    );
  }
}

function validateConfigValue(value: unknown): Config {
  const root = object(value, "$config");
  if (root.planFormat !== undefined) {
    const detail = root.planFormat === "html"
      ? 'The old planFormat: "html" capture setting cannot author agent plans safely.'
      : "The planFormat capture setting has been removed.";
    throw new ConfigError(
      "PLANLOFT_CONFIG_MIGRATION_REQUIRED",
      `${detail} Remove planFormat from config.json; agent-authored documents now resolve to Markdown, while explicit trusted HTML input remains available through --trusted-html.`,
    );
  }
  exactKeys(root, ["version", "theme", "defaultTtlDays", "projects", "giscus", "github", "vercel"], "$config");
  if (root.version !== 1) fail("$config.version must equal 1");
  const theme = nonEmptyString(root.theme, "$config.theme");
  assertThemeName(theme);
  const defaultTtlDays = configTtlDays(root.defaultTtlDays);
  const projectValues = object(root.projects, "$config.projects");
  const projects: Config["projects"] = {};
  for (const [key, projectValue] of Object.entries(projectValues)) {
    if (!key) fail("$config.projects keys must not be empty");
    const project = object(projectValue, `$config.projects.${key}`);
    exactKeys(project, ["theme", "giscus"], `$config.projects.${key}`);
    const projectTheme = optionalString(project.theme, `$config.projects.${key}.theme`);
    if (projectTheme !== undefined) assertThemeName(projectTheme);
    projects[key] = {
      ...(projectTheme === undefined ? {} : { theme: projectTheme }),
      ...(project.giscus === undefined
        ? {}
        : { giscus: validateStringMap(project.giscus, `$config.projects.${key}.giscus`, GISCUS_KEYS) }),
    };
  }

  return {
    version: 1,
    theme,
    defaultTtlDays,
    projects,
    ...(root.giscus === undefined ? {} : { giscus: validateStringMap(root.giscus, "$config.giscus", GISCUS_KEYS) }),
    ...(root.github === undefined ? {} : { github: validateStringMap(root.github, "$config.github", GITHUB_KEYS) }),
    ...(root.vercel === undefined ? {} : { vercel: validateStringMap(root.vercel, "$config.vercel", VERCEL_KEYS) }),
  };
}

const GISCUS_KEYS = ["repo", "repoId", "category", "categoryId"] as const;
const GITHUB_KEYS = ["token", "user", "repo"] as const;
const VERCEL_KEYS = ["token"] as const;

function validateStringMap<const K extends readonly string[]>(
  value: unknown,
  label: string,
  keys: K,
): Partial<Record<K[number], string>> {
  const record = object(value, label);
  exactKeys(record, keys, label);
  const validated: Record<string, string> = {};
  for (const key of keys) {
    const field = optionalString(record[key], `${label}.${key}`);
    if (field !== undefined) validated[key] = field;
  }
  return validated as Partial<Record<K[number], string>>;
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const unknown = Object.keys(value).find((key) => !allowed.includes(key));
  if (unknown) fail(`${label} contains unknown property "${unknown}"`);
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") fail(`${label} must be a non-empty string`);
  return value;
}

function optionalString(value: unknown, label: string): string | undefined {
  return value === undefined ? undefined : nonEmptyString(value, label);
}

function configTtlDays(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value <= 0 ||
    value > MAX_TTL_DAYS
  ) {
    fail(`config.defaultTtlDays ${TTL_RULE}.`);
  }
  return value;
}

function optionalNestedUpdate<K extends string, V extends Partial<Record<string, string>>>(
  key: K,
  current: V | undefined,
  patch: V | undefined,
): Partial<Record<K, V>> {
  if (patch === undefined) return {};
  const defined = Object.fromEntries(
    Object.entries(patch).filter((entry): entry is [string, string] => entry[1] !== undefined),
  ) as V;
  if (Object.keys(defined).length === 0) return {};
  return { [key]: { ...current, ...defined } } as Partial<Record<K, V>>;
}

function assertConfigIsNotDanglingSymlink(file: string): void {
  try {
    fs.statSync(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    try {
      fs.lstatSync(file);
    } catch (inspectionError) {
      if ((inspectionError as NodeJS.ErrnoException).code === "ENOENT") return;
      throw inspectionError;
    }
    throw new Error(`Configuration path ${file} is a dangling symbolic link.`);
  }
}

function fail(message: string): never {
  throw new Error(message);
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** Theme resolution order: plan > project > global (ADR-0001 §D8). */
export function resolveTheme(cfg: Config, projectKey: string, planTheme?: string): string {
  const theme = planTheme ?? cfg.projects[projectKey]?.theme ?? cfg.theme;
  validateTheme(theme);
  return theme;
}
