export const TTL_RULE = "must be a finite positive integer";

/** Parse the single TTL contract shared by CLI flags, configuration, and publishing. */
export function parseTtlDays(value: unknown, field = "TTL"): number {
  const parsed =
    typeof value === "string" && /^[1-9]\d*$/.test(value)
      ? Number(value)
      : typeof value === "number"
        ? value
        : Number.NaN;

  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${field} ${TTL_RULE}.`);
  }
  return parsed;
}

export function resolveTtlDays(override: number | undefined, configured: unknown): number {
  return override === undefined
    ? parseTtlDays(configured, "config.defaultTtlDays")
    : parseTtlDays(override, "--ttl");
}
