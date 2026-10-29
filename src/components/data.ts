// Shared input handling for data components. MDX props arrive untyped from authors,
// so each component checks its column names once here and fails the render with a
// message that names the component and the missing key.

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

/** Axis and label formatting: compact notation, few decimals. */
export function numberFormatter(formatting: ValueFormatting) {
  return intlFormatter(formatting, intlOptions(formatting));
}

/** Tooltip formatting: the chart's style, but every digit of the value. */
export function exactNumberFormatter(formatting: ValueFormatting) {
  const options = intlOptions(formatting);
  const standard = intlFormatter(formatting, { ...options, notation: "standard", maximumFractionDigits: 20 });
  const scientific = intlFormatter(formatting, { ...options, notation: "scientific", maximumSignificantDigits: 21 });
  return (value: number) => {
    const [mantissa = "", exponent = "0"] = Math.abs(value).toString().split("e");
    const decimals = (mantissa.split(".")[1]?.length ?? 0) - Number(exponent) - (formatting.format === "percent" ? 2 : 0);
    // Intl's fraction-digit limit must not round small measurements to zero.
    return decimals > 20 ? scientific(value) : standard(value);
  };
}

function intlOptions({ format = "number", currency = "USD" }: ValueFormatting): Intl.NumberFormatOptions {
  return INTL_OPTIONS[format](currency);
}

function intlFormatter({ unit }: ValueFormatting, options: Intl.NumberFormatOptions) {
  const intl = new Intl.NumberFormat("en-US", options);
  const suffix = unit ? ` ${unit}` : "";
  return (value: number) => `${intl.format(value).replace("-", "−")}${suffix}`;
}

const INTL_OPTIONS: Record<NumberFormat, (currency: string) => Intl.NumberFormatOptions> = {
  number: () => ({ maximumFractionDigits: 2 }),
  compact: () => ({ notation: "compact", maximumFractionDigits: 1 }),
  percent: () => ({ style: "percent", maximumFractionDigits: 2 }),
  currency: (currency) => ({ style: "currency", currency, notation: "compact", maximumFractionDigits: 1 }),
};

export class ComponentInputError extends Error {
  constructor(component: string, message: string) {
    super(`<${component}> ${message}`);
    this.name = "ComponentInputError";
  }
}

export function requireRows(component: string, data: readonly Row[] | undefined): readonly Row[] {
  if (!Array.isArray(data) || data.length === 0) {
    throw new ComponentInputError(component, "needs a non-empty `data` array of objects.");
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

export function sumNumeric(values: readonly (number | null)[]): number | null {
  let sum = 0;
  for (const value of values) {
    if (value === null) return null;
    sum += value;
  }
  return sum;
}

export function exactCell(value: number | null): string {
  return value === null ? "—" : String(value);
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
