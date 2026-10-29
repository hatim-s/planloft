import { cell, createChartScene, defineChart, type ChartScene } from "@tanstack/charts";
import { scaleBand } from "@tanstack/charts/scales/band";
import type { ReactNode } from "react";
import { ChartFigure, drawFrames, markHits, useChartId, type Frame } from "./chart-frame.js";
import {
  columnLabel,
  ComponentInputError,
  resolveFormatting,
  numericCell,
  requireKeys,
  requireRows,
  textCell,
  type Row,
  type ValueFormatting,
} from "./data.js";

export interface HeatmapProps extends ValueFormatting {
  /** One row per cell. */
  data: readonly Row[];
  /** Column category. */
  x: string;
  /** Row category. */
  y: string;
  /** Numeric intensity. */
  value: string;
  title?: string;
  caption?: ReactNode;
  labels?: Readonly<Record<string, string>>;
}

// Five steps of one hue: enough to read rank, few enough to match a legend swatch by eye.
const STEPS = 5;
const stepColor = (step: number) =>
  `color-mix(in oklab, var(--pl-sequential) ${Math.round(14 + (step / (STEPS - 1)) * 86)}%, var(--pl-paper))`;
const CELL_HEIGHT: Record<Frame["name"], number> = { compact: 30, regular: 34, wide: 38 };

interface HeatCell {
  id: string;
  column: string;
  row: string;
  value: number | null;
  step: string;
}

export function Heatmap({ data, x, y, value, title, caption, labels, ...formatting }: HeatmapProps) {
  const rows = requireRows("Heatmap", data);
  requireKeys("Heatmap", rows, [x, y, value]);

  const id = useChartId();
  const { axis: format, exact } = resolveFormatting("Heatmap", formatting);
  const values = rows.map((row) => numericCell(row, value)).filter((number): number is number => number !== null);
  if (values.length === 0) throw new ComponentInputError("Heatmap", `needs at least one numeric value for "${value}".`, "invalid_value");
  const min = Math.min(...values);
  const max = Math.max(...values);
  const stepOf = (number: number) => (max === min ? STEPS - 1 : Math.min(STEPS - 1, Math.floor(((number - min) / (max - min)) * STEPS)));
  const columns = [...new Set(rows.map((row) => textCell(row, x)))];
  const rowNames = [...new Set(rows.map((row) => textCell(row, y)))];
  const cells: HeatCell[] = rows.map((row) => {
    const number = numericCell(row, value);
    return {
      id: `${textCell(row, y)}:${textCell(row, x)}`,
      column: textCell(row, x),
      row: textCell(row, y),
      value: number,
      step: number === null ? "empty" : String(stepOf(number)),
    };
  });
  if (new Set(cells.map((cell) => JSON.stringify([cell.row, cell.column]))).size !== cells.length) {
    throw new ComponentInputError("Heatmap", "needs a unique row and column pair for each cell.", "duplicate_coordinate");
  }
  const steps = Array.from({ length: STEPS }, (_, step) => step);
  const bound = (step: number) => min + ((max - min) * step) / STEPS;
  const hits = (scene: ChartScene) =>
    markHits(scene, (index) => {
      const entry = cells[index]!;
      return {
        title: `${entry.row}, ${entry.column}`,
        rows: [[columnLabel(value, labels), exact(entry.value)]],
        color: entry.value === null ? undefined : stepColor(stepOf(entry.value)),
      };
    });

  const frames = drawFrames(id, title ?? `Heatmap of ${columnLabel(value, labels)}`, (frame) =>
    createChartScene(
      defineChart({
        focus: false,
        marks: [cell(cells, { x: "column", y: "row", color: "step", inset: 1.5, radius: 3 })],
        scales: {
          x: {
            scale: () => scaleBand<string>().domain(columns).padding(0),
            side: "top",
            axis: { line: false, ticks: { line: false }, tickLabels: { fontSize: frame.tickSize } },
          },
          y: {
            scale: () => scaleBand<string>().domain(rowNames).padding(0),
            axis: { line: false, ticks: { line: false }, tickLabels: { fontSize: frame.tickSize } },
          },
        },
        color: {
          domain: [...steps.map(String), "empty"],
          range: [...steps.map(stepColor), "transparent"],
        },
      }),
      { width: frame.width, height: rowNames.length * CELL_HEIGHT[frame.name] + 36 },
    ),
    hits,
  );

  return (
    <ChartFigure
      kind="heatmap"
      title={title}
      caption={caption}
      legend={steps.map((step) => ({
        label: step === STEPS - 1 ? `${format(bound(step))} and above` : `${format(bound(step))} to ${format(bound(step + 1))}`,
        color: stepColor(step),
        shape: "block",
      }))}
      frames={frames}
      data={{
        columns: [columnLabel(y, labels), ...columns],
        rows: rowNames.map((name) => [
          name,
          ...columns.map((column) => {
            const match = cells.find((entry) => entry.row === name && entry.column === column);
            return exact(match?.value ?? null);
          }),
        ]),
      }}
    />
  );
}
