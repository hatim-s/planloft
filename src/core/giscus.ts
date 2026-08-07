import type { Config, GiscusConfig } from "./types.js";

export const GISCUS_CONFIG_ERROR = "PLANLOFT_GISCUS_CONFIG_INCOMPLETE";
const REQUIRED_FIELDS = ["repo", "repoId", "category", "categoryId"] as const;

/** Project values override global values field-by-field. */
export function resolveGiscusConfig(cfg: Config, projectKey: string): GiscusConfig {
  const resolved = {
    ...cfg.giscus,
    ...cfg.projects[projectKey]?.giscus,
  } as Partial<GiscusConfig>;
  return validateGiscusConfig(resolved);
}

export function validateGiscusConfig(value: Partial<GiscusConfig>): GiscusConfig {
  const missing = REQUIRED_FIELDS.filter((field) => {
    const candidate = value[field];
    return typeof candidate !== "string" || candidate.trim().length === 0;
  });
  if (missing.length > 0) {
    throw new Error(
      `${GISCUS_CONFIG_ERROR}: --comments requires ${missing
        .map((field) => `giscus.${field}`)
        .join(", ")}. Enable GitHub Discussions, configure giscus, and try again.`,
    );
  }

  const repo = value.repo!.trim();
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) {
    throw new Error(`${GISCUS_CONFIG_ERROR}: giscus.repo must use the owner/repository form.`);
  }

  return {
    repo,
    repoId: value.repoId!.trim(),
    category: value.category!.trim(),
    categoryId: value.categoryId!.trim(),
  };
}
