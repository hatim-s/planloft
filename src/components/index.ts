import "./style-variables.js";
import type { BuiltinComponentName } from "./metadata.js";
import { Badge } from "./badge.js";
import { BarChart } from "./bar-chart.js";
import { Callout } from "./callout.js";
import { DataTable } from "./data-table.js";
import { DonutChart } from "./donut-chart.js";
import { Stat, Stats, Status } from "./figures.js";
import { Heatmap } from "./heatmap.js";
import { LineChart } from "./line-chart.js";
import { Sparkline } from "./sparkline.js";
import { Checklist, Todo } from "./tasks.js";
import { Milestone, Timeline } from "./timeline.js";
import { WaterfallChart } from "./waterfall-chart.js";

export { ComponentInputError, isComponentInputError } from "./data.js";
export type { Cell, NumberFormat, Row, ValueFormatting } from "./data.js";
export { Badge, type BadgeColor, type BadgeProps } from "./badge.js";
export { BarChart, type BarChartProps } from "./bar-chart.js";
export { Callout, type CalloutProps, type CalloutTone } from "./callout.js";
export { DataTable, type DataTableColumn, type DataTableProps } from "./data-table.js";
export { DonutChart, type DonutChartProps } from "./donut-chart.js";
export { Stat, Stats, Status, type StatProps, type StatsProps, type StatusProps, type StatusTone } from "./figures.js";
export { Heatmap, type HeatmapProps } from "./heatmap.js";
export { LineChart, type LineChartProps } from "./line-chart.js";
export { Sparkline, type SparklineProps } from "./sparkline.js";
export { Checklist, Todo, type ChecklistProps, type TodoProps } from "./tasks.js";
export { Milestone, Timeline, type MilestoneProps, type MilestoneState, type TimelineProps } from "./timeline.js";
export { WaterfallChart, type WaterfallChartProps } from "./waterfall-chart.js";

/** Every built-in, keyed by its MDX tag. Documents can use these without importing them. */
export const builtinComponents = {
  Badge,
  BarChart,
  Callout,
  Checklist,
  DataTable,
  DonutChart,
  Heatmap,
  LineChart,
  Milestone,
  Sparkline,
  Stat,
  Stats,
  Status,
  Timeline,
  Todo,
  WaterfallChart,
} as const satisfies Record<BuiltinComponentName, unknown>;
