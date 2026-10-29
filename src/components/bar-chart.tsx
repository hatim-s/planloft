import { barX, barY, createChartScene, defineChart, group, text, type ChartScene } from "@tanstack/charts";
import { scaleBand } from "@tanstack/charts/scales/band";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import type { ReactNode } from "react";
import { ChartFigure, drawFrames, markHits, requireSeriesCount, seriesColor, useChartId, type Frame } from "./chart-frame.js";
import {
  columnLabel,
  ComponentInputError,
  keyList,
  resolveFormatting,
  numericCell,
  requireKeys,
  requireRows,
  sumNumeric,
  textCell,
  type Row,
  type ValueFormatting,
} from "./data.js";

export const BAR_LAYOUTS = ["grouped", "stacked"] as const;
export const BAR_ORIENTATIONS = ["vertical", "horizontal"] as const;

export interface BarChartProps extends ValueFormatting {
  data: readonly Row[];
  /** Category column. */
  x: string;
  /** One column per series. Several columns are grouped side by side unless `layout="stacked"`. */
  y: string | readonly string[];
  layout?: (typeof BAR_LAYOUTS)[number];
  /** Horizontal bars suit long category names and rankings. */
  orientation?: (typeof BAR_ORIENTATIONS)[number];
  /** Order categories by their total. Source order is kept by default. */
  sort?: "ascending" | "descending";
  title?: string;
  caption?: ReactNode;
  labels?: Readonly<Record<string, string>>;
}

interface Bar {
  id: string;
  category: string;
  series: string;
  value: number | null;
}

const VERTICAL_HEIGHT: Record<Frame["name"], number> = { compact: 250, regular: 300, wide: 340 };
const ROW_HEIGHT: Record<Frame["name"], number> = { compact: 36, regular: 38, wide: 42 };
const THICKNESS: Record<Frame["name"], number> = { compact: 22, regular: 28, wide: 34 };

export function BarChart({
  data,
  x,
  y,
  layout = "grouped",
  orientation = "vertical",
  sort,
  title,
  caption,
  labels,
  ...formatting
}: BarChartProps) {
  const rows = requireRows("BarChart", data);
  const series = keyList(y);
  requireKeys("BarChart", rows, [x, ...series]);
  requireSeriesCount("BarChart", series.length);
  if (!BAR_LAYOUTS.includes(layout)) throw new ComponentInputError("BarChart", `layout must be one of ${BAR_LAYOUTS.join(", ")}.`);
  if (!BAR_ORIENTATIONS.includes(orientation)) {
    throw new ComponentInputError("BarChart", `orientation must be one of ${BAR_ORIENTATIONS.join(", ")}.`);
  }

  const id = useChartId();
  const { axis: format, exact } = resolveFormatting("BarChart", formatting);
  const total = (row: Row) => sumNumeric(series.map((key) => numericCell(row, key)));
  const ordered = sort ? [...rows].sort((a, b) => {
    const aTotal = total(a);
    const bTotal = total(b);
    if (aTotal === null) return bTotal === null ? 0 : 1;
    if (bTotal === null) return -1;
    return sort === "ascending" ? aTotal - bTotal : bTotal - aTotal;
  }) : rows;
  const categories = ordered.map((row) => textCell(row, x));
  if (new Set(categories).size !== categories.length) {
    throw new ComponentInputError("BarChart", `needs unique categories in column "${x}".`, "duplicate_category");
  }
  const bars: Bar[] = ordered.flatMap((row) =>
    series.map((key) => ({ id: `${key}:${textCell(row, x)}`, category: textCell(row, x), series: key, value: numericCell(row, key) })),
  );
  const single = series.length === 1;
  const stacked = layout === "stacked" && !single;
  const grouped = !stacked && !single;
  const rowHeight = (frame: Frame) => ROW_HEIGHT[frame.name] + (grouped ? (series.length - 1) * THICKNESS[frame.name] * 0.9 : 0);
  const horizontal = orientation === "horizontal";
  // Only a lone series gets value labels; with several series the legend and the data
  // table carry exact values, and labels on every segment would crowd the bars.
  const labelled = single ? bars : [];
  const color = { domain: series, range: series.map((_, index) => seriesColor(index)) };
  const barStyle = {
    color: "series" as const,
    radius: { end: 3 },
    // A stroke in the page colour opens a hairline gap between touching segments.
    ...(stacked ? { stroke: "var(--pl-paper)", strokeWidth: 1.5 } : {}),
    ...(grouped ? { layout: group({ padding: 0.15 }) } : {}),
  };
  const ariaLabel = title ?? `Bar chart of ${series.map((key) => columnLabel(key, labels)).join(", ")} by ${columnLabel(x, labels)}`;
  // Stacked targets show every series, so even overlapping subpixel segments
  // remain readable from whichever segment receives the pointer.
  const hits = (scene: ChartScene) =>
    markHits(scene, (index) => {
      const bar = bars[index]!;
      const row = ordered[Math.floor(index / series.length)]!;
      return {
        title: bar.category,
        rows: [
          ...(stacked
            ? series.map((key) => [columnLabel(key, labels), exact(numericCell(row, key))] as const)
            : [[columnLabel(bar.series, labels), exact(bar.value)] as const]),
          ...(stacked ? [["Total", exact(total(row))] as const] : []),
        ],
        color: seriesColor(series.indexOf(bar.series)),
      };
    });

  const frames = drawFrames(id, ariaLabel, (frame) => {
    const ticks = { fontSize: frame.tickSize };
    const valueAxis = {
      scale: scaleLinear,
      nice: true,
      grid: true,
      axis: { line: false, ticks: { line: false as const, count: 5, format }, tickLabels: ticks },
    };
    // Grouped bars are capped in thickness, so the band is narrowed to fit the group
    // instead of spreading capped bars across a wide slot.
    const extent = horizontal ? categories.length * rowHeight(frame) : frame.width - 56;
    const groupWidth = grouped ? series.length * 1.3 * THICKNESS[frame.name] : (horizontal ? 0.55 : 0.62) * (extent / categories.length);
    const padding = Math.min(0.75, Math.max(0.2, 1 - groupWidth / (extent / categories.length)));
    const categoryAxis = {
      scale: () => scaleBand<string>().domain(categories).paddingInner(padding).paddingOuter(padding / 2),
      axis: { ticks: { line: false as const }, tickLabels: ticks },
    };
    const valueLabel = {
      text: (bar: Bar) => (bar.value === null ? null : format(bar.value)),
      fontSize: frame.tickSize,
      fontWeight: 600,
      fill: "currentColor",
    };
    if (horizontal) {
      return createChartScene(
        defineChart({
        focus: false,
          marks: [
            barX(bars, { x: "value", y: "category", z: "series", maxThickness: THICKNESS[frame.name], ...barStyle }),
            text(labelled, { x: "value", y: "category", anchor: "start", dx: 6, ...valueLabel }),
          ],
          scales: { x: valueAxis, y: categoryAxis },
          color,
        }),
        { width: frame.width, height: categories.length * rowHeight(frame) + 48 },
      );
    }
    return createChartScene(
      defineChart({
        focus: false,
        marks: [
          barY(bars, { x: "category", y: "value", z: "series", maxThickness: THICKNESS[frame.name], ...barStyle }),
          text(labelled, { x: "category", y: "value", dy: -10, ...valueLabel }),
        ],
        scales: { x: categoryAxis, y: valueAxis },
        color,
      }),
      { width: frame.width, height: VERTICAL_HEIGHT[frame.name] },
    );
  }, hits);

  return (
    <ChartFigure
      kind={horizontal ? "bar-horizontal" : "bar"}
      title={title}
      caption={caption}
      legend={single ? undefined : series.map((key, index) => ({ label: columnLabel(key, labels), color: seriesColor(index), shape: "block" }))}
      frames={frames}
      data={{
        columns: [columnLabel(x, labels), ...series.map((key) => columnLabel(key, labels)), ...(stacked ? ["Total"] : [])],
        rows: ordered.map((row) => [
          textCell(row, x),
          ...series.map((key) => exact(numericCell(row, key))),
          ...(stacked ? [exact(total(row))] : []),
        ]),
      }}
    />
  );
}
