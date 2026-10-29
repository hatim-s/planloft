/** Kept free of rendering imports so compiler envelopes can validate names cheaply. */
export const BUILTIN_COMPONENT_NAMES = [
  "Badge", "BarChart", "Callout", "Checklist", "DataTable", "DonutChart", "Heatmap", "LineChart",
  "Milestone", "Sparkline", "Stat", "Stats", "Status", "Timeline", "Todo", "WaterfallChart",
] as const;
export type BuiltinComponentName = (typeof BUILTIN_COMPONENT_NAMES)[number];

export function isBuiltinComponentName(value: unknown): value is BuiltinComponentName {
  return BUILTIN_COMPONENT_NAMES.some((name) => name === value);
}

export const COMPONENT_INPUT_REASONS = [
  "invalid_props", "invalid_format", "invalid_currency", "empty_data", "missing_column",
  "duplicate_category", "duplicate_coordinate", "series_limit", "invalid_value",
] as const;
export type ComponentInputReason = (typeof COMPONENT_INPUT_REASONS)[number];

export function isComponentInputReason(value: unknown): value is ComponentInputReason {
  return COMPONENT_INPUT_REASONS.some((reason) => reason === value);
}
