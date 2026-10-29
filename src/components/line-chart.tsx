import { areaY, createChartScene, defineChart, dot, lineY, text, type ChartScene } from "@tanstack/charts";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import { scalePoint } from "@tanstack/charts/scales/point";
import type { ReactNode } from "react";
import { ChartFigure, columnHits, drawFrames, requireSeriesCount, seriesColor, useChartId, type Frame } from "./chart-frame.js";
import {
  columnLabel,
  ComponentInputError,
  exactCell,
  exactNumberFormatter,
  keyList,
  numberFormatter,
  numericCell,
  requireKeys,
  requireRows,
  textCell,
  type Row,
  type ValueFormatting,
} from "./data.js";

export interface LineChartProps extends ValueFormatting {
  data: readonly Row[];
  /** Column for the horizontal axis, read as ordered categories. */
  x: string;
  /** One column per line. */
  y: string | readonly string[];
  title?: string;
  caption?: ReactNode;
  /** Display names for the y columns. */
  labels?: Readonly<Record<string, string>>;
  /** Fill under each line with a fading gradient. On by default. */
  area?: boolean;
}

interface Point {
  id: string;
  x: string;
  series: string;
  value: number | null;
}

const HEIGHT: Record<Frame["name"], number> = { compact: 240, regular: 300, wide: 360 };

export function LineChart({ data, x, y, title, caption, labels, area = true, ...formatting }: LineChartProps) {
  const rows = requireRows("LineChart", data);
  const series = keyList(y);
  requireKeys("LineChart", rows, [x, ...series]);
  requireSeriesCount("LineChart", series.length);

  const id = useChartId();
  const format = numberFormatter(formatting);
  const exact = exactNumberFormatter(formatting);
  const points: Point[] = rows.flatMap((row) =>
    series.map((key) => ({ id: `${key}:${textCell(row, x)}`, x: textCell(row, x), series: key, value: numericCell(row, key) })),
  );
  const categories = rows.map((row) => textCell(row, x));
  if (new Set(categories).size !== categories.length) {
    throw new ComponentInputError("LineChart", `needs unique categories in column "${x}". Combine repeated categories or give each point a distinct label.`);
  }
  const hits = (scene: ChartScene) =>
    columnHits(scene, categories, (index) => {
      const category = categories[index]!;
      return {
        title: category,
        rows: series.map((key) => {
          const value = points.find((point) => point.x === category && point.series === key)?.value ?? null;
          return [columnLabel(key, labels), value === null ? "—" : exact(value)];
        }),
      };
    });
  const last = series.flatMap((key) => {
    const latest = points.filter((point) => point.series === key && point.value !== null).at(-1);
    return latest ? [latest] : [];
  });
  const gradientId = (index: number) => `${id}-area-${index}`;
  const single = series.length === 1;

  const frames = drawFrames(id, title ?? `Line chart of ${series.map((key) => columnLabel(key, labels)).join(", ")}`, (frame) =>
    createChartScene(
      defineChart({
        focus: false,
        marks: [
          ...(area
            ? series.map((key, index) =>
                areaY(points.filter((point) => point.series === key), {
                  id: `area-${index}`,
                  x: "x",
                  y: "value",
                  fill: `url(#${gradientId(index)})`,
                  fillOpacity: 1,
                }),
              )
            : []),
          lineY(points, { x: "x", y: "value", z: "series", color: "series", strokeWidth: 2 }),
          dot(last, { x: "x", y: "value", color: "series", r: 4, stroke: "var(--pl-paper)", strokeWidth: 2 }),
          ...(single
            ? [text(last, {
                x: "x",
                y: "value",
                text: (point) => (point.value === null ? null : format(point.value)),
                anchor: "start",
                dx: 9,
                fontSize: frame.tickSize + 1,
                fontWeight: 600,
                fill: "currentColor",
              })]
            : []),
        ],
        scales: {
          x: {
            scale: () => scalePoint<string>().padding(0.25),
            axis: { ticks: { line: false }, tickLabels: { fontSize: frame.tickSize } },
          },
          y: {
            scale: scaleLinear,
            nice: true,
            grid: true,
            axis: { line: false, ticks: { line: false, count: 5, format }, tickLabels: { fontSize: frame.tickSize } },
          },
        },
        color: { domain: series, range: series.map((_, index) => seriesColor(index)) },
        gradients: series.map((_, index) => ({
          id: gradientId(index),
          x1: 0,
          y1: 0,
          x2: 0,
          y2: 1,
          // Several washes overlap, so each is fainter and fades out before the baseline.
          stops: single
            ? [{ offset: 0, color: seriesColor(index), opacity: 0.3 }, { offset: 1, color: seriesColor(index), opacity: 0 }]
            : [{ offset: 0, color: seriesColor(index), opacity: 0.13 }, { offset: 0.7, color: seriesColor(index), opacity: 0 }],
        })),
      }),
      { width: frame.width, height: HEIGHT[frame.name] },
    ),
    hits,
  );

  return (
    <ChartFigure
      kind="line"
      title={title}
      caption={caption}
      legend={single ? undefined : series.map((key, index) => ({ label: columnLabel(key, labels), color: seriesColor(index), shape: "line" }))}
      frames={frames}
      data={{
        columns: [columnLabel(x, labels), ...series.map((key) => columnLabel(key, labels))],
        rows: rows.map((row) => [textCell(row, x), ...series.map((key) => exactCell(numericCell(row, key)))]),
      }}
    />
  );
}
