import "./style-variables.js";
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

export {
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
};
export { ComponentInputError } from "./data.js";
export type { Cell, NumberFormat, Row, ValueFormatting } from "./data.js";
export type { BadgeColor, BadgeProps } from "./badge.js";
export type { BarChartProps } from "./bar-chart.js";
export type { CalloutProps, CalloutTone } from "./callout.js";
export type { DataTableColumn, DataTableProps } from "./data-table.js";
export type { DonutChartProps } from "./donut-chart.js";
export type { StatProps, StatsProps, StatusProps, StatusTone } from "./figures.js";
export type { HeatmapProps } from "./heatmap.js";
export type { LineChartProps } from "./line-chart.js";
export type { SparklineProps } from "./sparkline.js";
export type { ChecklistProps, TodoProps } from "./tasks.js";
export type { MilestoneProps, MilestoneState, TimelineProps } from "./timeline.js";
export type { WaterfallChartProps } from "./waterfall-chart.js";

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
} as const;
