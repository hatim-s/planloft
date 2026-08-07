const MILLISECONDS_PER_DAY = 86_400_000;
const MAX_DATE_MILLISECONDS = 8_640_000_000_000_000;

export const MAX_TTL_DAYS = MAX_DATE_MILLISECONDS / MILLISECONDS_PER_DAY;
export const TTL_RULE = `must be a finite positive integer no greater than ${MAX_TTL_DAYS}`;

/** Parse the single TTL contract shared by CLI flags, configuration, and publishing. */
export function parseTtlDays(value: unknown, field = "TTL"): number {
  const parsed =
    typeof value === "string" && /^[1-9]\d*$/.test(value)
      ? Number(value)
      : typeof value === "number"
        ? value
        : Number.NaN;

  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > MAX_TTL_DAYS) {
    throw new Error(`${field} ${TTL_RULE}.`);
  }
  return parsed;
}

/** Resolve and validate the exact ISO expiry before publication performs any effects. */
export function calculateExpiry(ttlDays: unknown, now: Date, field = "TTL"): string {
  const parsed = parseTtlDays(ttlDays, field);
  const nowMilliseconds = now.getTime();
  const expiryMilliseconds = nowMilliseconds + parsed * MILLISECONDS_PER_DAY;
  if (
    !Number.isFinite(nowMilliseconds) ||
    !Number.isSafeInteger(expiryMilliseconds) ||
    Math.abs(expiryMilliseconds) > MAX_DATE_MILLISECONDS
  ) {
    throw new Error(`${field} does not produce a representable expiry from the current time.`);
  }
  return new Date(expiryMilliseconds).toISOString();
}

export function resolveTtlDays(override: number | undefined, configured: unknown): number {
  return override === undefined
    ? parseTtlDays(configured, "config.defaultTtlDays")
    : parseTtlDays(override, "--ttl");
}
