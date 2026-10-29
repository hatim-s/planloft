import type { ComponentInputReason } from "./metadata.js";

export type Cell = string | number | null;
export type Row = Readonly<Record<string, Cell>>;

export const NUMBER_FORMATS = ["number", "compact", "percent", "currency"] as const;
export type NumberFormat = (typeof NUMBER_FORMATS)[number];

export interface ValueFormatting {
  /** `percent` expects fractions (0.42 renders as 42%). */
  format?: NumberFormat;
  /** ISO currency code for `format="currency"`. */
  currency?: string;
  /** Appended after the number, for units such as "ms" or "pts". */
  unit?: string;
}

/** Validate author formatting once, then share its semantics across every representation. */
export function resolveFormatting(component: string, { format = "number", currency = "USD", unit }: ValueFormatting) {
  if (!NUMBER_FORMATS.includes(format)) {
    throw new ComponentInputError(component, `format must be one of ${NUMBER_FORMATS.join(", ")}.`, "invalid_format");
  }
  if (typeof currency !== "string" || !/^[a-z]{3}$/i.test(currency)) {
    throw new ComponentInputError(component, "currency must be a three-letter ISO currency code.", "invalid_currency");
  }
  if (unit !== undefined && typeof unit !== "string") {
    throw new ComponentInputError(component, "unit must be a string.");
  }
  const options = INTL_OPTIONS[format](currency);
  const axis = intlFormatter(unit, options);
  const standard = intlFormatter(unit, { ...options, notation: "standard", minimumFractionDigits: undefined, maximumFractionDigits: 20 });
  const scientific = intlFormatter(unit, { ...options, notation: "scientific", minimumFractionDigits: undefined, maximumSignificantDigits: 21 });
  const exact = (value: number | null) => {
    if (value === null) return "—";
    const [mantissa = "", exponent = "0"] = Math.abs(value).toString().split("e");
    const decimals = (mantissa.split(".")[1]?.length ?? 0) - Number(exponent) - (format === "percent" ? 2 : 0);
    // Intl's fraction-digit limit must not round small measurements to zero.
    return decimals > 20 ? scientific(value) : standard(value);
  };
  return { axis, exact, table: format === "compact" ? axis : exact };
}

function intlFormatter(unit: string | undefined, options: Intl.NumberFormatOptions) {
  const intl = new Intl.NumberFormat("en-US", options);
  const suffix = unit ? ` ${unit}` : "";
  return (value: number) => `${intl.format(value === 0 ? 0 : value).replaceAll("-", "−")}${suffix}`;
}

const INTL_OPTIONS: Record<NumberFormat, (currency: string) => Intl.NumberFormatOptions> = {
  number: () => ({ maximumFractionDigits: 2 }),
  compact: () => ({ notation: "compact", maximumFractionDigits: 1 }),
  percent: () => ({ style: "percent", maximumFractionDigits: 2 }),
  currency: (currency) => ({ style: "currency", currency, notation: "compact", minimumFractionDigits: 0, maximumFractionDigits: 1 }),
};

const componentInputErrors = new WeakSet<ComponentInputError>();

export class ComponentInputError extends Error {
  constructor(readonly component: string, message: string, readonly reason: ComponentInputReason = "invalid_props") {
    super(`<${component}> ${message}`);
    this.name = "ComponentInputError";
    componentInputErrors.add(this);
    Object.freeze(this);
  }
}

export function isComponentInputError(value: unknown): value is ComponentInputError {
  return value instanceof ComponentInputError && componentInputErrors.has(value);
}

export function requireRows(component: string, data: readonly Row[] | undefined): readonly Row[] {
  if (!Array.isArray(data) || data.length === 0) {
    throw new ComponentInputError(component, "needs a non-empty `data` array of objects.", "empty_data");
  }
  return data;
}

export function requireKeys(component: string, data: readonly Row[], keys: readonly string[]): void {
  const available = Object.keys(data[0] ?? {});
  for (const key of keys) {
    if (!data.some((row) => key in row)) {
      throw new ComponentInputError(
        component,
        `references the column "${key}", which no row has. Available columns: ${available.join(", ")}.`,
        "missing_column",
      );
    }
  }
}

/** A numeric cell; missing values stay null so lines break instead of dropping to zero. */
export function numericCell(row: Row, key: string): number | null {
  const value = row[key];
  if (value === null || value === undefined || (typeof value === "string" && value.trim() === "")) return null;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

export function sumNumeric(values: readonly number[]): number;
export function sumNumeric(values: readonly (number | null)[]): number | null;
export function sumNumeric(values: readonly (number | null)[]): number | null {
  const sum = new DecimalSum();
  let total = 0;
  for (const value of values) {
    if (value === null) return null;
    total = sum.add(value);
  }
  return total;
}

/** Add the shortest decimal representations, preserving cancellation and small contributions. */
export class DecimalSum {
  private coefficient = 0n;
  private exponent = 0;

  add(value: number): number {
    const [mantissa = "0", power = "0"] = value.toString().split("e");
    const exponent = Number(power) - (mantissa.split(".")[1]?.length ?? 0);
    const coefficient = BigInt(mantissa.replace(".", ""));
    const commonExponent = Math.min(this.exponent, exponent);
    this.coefficient = this.coefficient * 10n ** BigInt(this.exponent - commonExponent)
      + coefficient * 10n ** BigInt(exponent - commonExponent);
    this.exponent = commonExponent;
    return Number(`${this.coefficient}e${this.exponent}`);
  }
}

export function textCell(row: Row, key: string): string {
  const value = row[key];
  return value === null || value === undefined ? "" : String(value);
}

export function keyList(value: string | readonly string[]): readonly string[] {
  return typeof value === "string" ? [value] : value;
}

/** Human label for a column key: an explicit label, else the key in sentence case. */
export function columnLabel(key: string, labels: Readonly<Record<string, string>> | undefined): string {
  const explicit = labels?.[key];
  if (explicit) return explicit;
  const spaced = key.replace(/[_-]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
