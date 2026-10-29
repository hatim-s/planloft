import { barY, createChartScene, defineChart, text, type ChartScene } from "@tanstack/charts";
import { scaleBand } from "@tanstack/charts/scales/band";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import type { ReactNode } from "react";
import { ChartFigure, drawFrames, markHits, useChartId, type Frame } from "./chart-frame.js";
import {
  columnLabel,
  ComponentInputError,
  DecimalSum,
  resolveFormatting,
  numericCell,
  requireKeys,
  requireRows,
  textCell,
  type Row,
  type ValueFormatting,
} from "./data.js";

export interface WaterfallChartProps extends ValueFormatting {
  data: readonly Row[];
  /** Step name column. */
  label: string;
  /** Signed contribution column. The first row is usually the starting amount. */
  value: string;
  /** Name of the closing total bar, or `false` to leave it out. */
  total?: string | false;
  /** Draw the first row as an opening balance rather than a change. On by default. */
  opening?: boolean;
  title?: string;
  caption?: ReactNode;
}

const KIND_COLOR = {
  increase: "var(--pl-positive)",
  decrease: "var(--pl-negative)",
  total: "var(--pl-neutral)",
} as const;
const KIND_LABEL = { increase: "Increase", decrease: "Decrease", total: "Balance" } as const;
const HEIGHT: Record<Frame["name"], number> = { compact: 260, regular: 300, wide: 340 };

export function WaterfallChart({
  data,
  label,
  value,
  total = "Total",
  opening = true,
  title,
  caption,
  ...formatting
}: WaterfallChartProps) {
  const rows = requireRows("WaterfallChart", data);
  requireKeys("WaterfallChart", rows, [label, value]);

  const id = useChartId();
  const { axis: format, exact } = resolveFormatting("WaterfallChart", formatting);
  const signed = (amount: number) => (amount > 0 ? `+${format(amount)}` : format(amount));
  const sum = new DecimalSum();
  let cursor = 0;
  const steps = rows.map((row, index) => {
    const amount = numericCell(row, value);
    if (amount === null) {
      throw new ComponentInputError("WaterfallChart", `needs a numeric value for "${value}" in row ${index + 1}.`, "invalid_value");
    }
    const start = cursor;
    const end = sum.add(amount);
    if (!Number.isFinite(end)) {
      throw new ComponentInputError("WaterfallChart", "needs finite running totals.", "invalid_value");
    }
    cursor = end;
    const kind = opening && index === 0 ? "total" : amount >= 0 ? "increase" : "decrease";
    return { step: textCell(row, label), delta: amount, start, end, kind, color: KIND_COLOR[kind] } as const;
  });
  if (total !== false) {
    steps.push({ step: total, delta: cursor, start: 0, end: cursor, kind: "total", color: KIND_COLOR.total });
  }
  const categories = steps.map((step) => step.step);
  if (new Set(categories).size !== categories.length) {
    throw new ComponentInputError("WaterfallChart", "needs unique step labels, including the closing total label.", "duplicate_category");
  }
  const kinds = [...new Set(steps.map((step) => step.kind))];
  const hits = (scene: ChartScene) =>
    markHits(scene, (index) => {
      const step = steps[index]!;
      return {
        title: step.step,
        rows: step.kind === "total"
          ? [[KIND_LABEL.total, exact(step.end)]]
          : [["Change", step.delta > 0 ? `+${exact(step.delta)}` : exact(step.delta)], ["Running total", exact(step.end)]],
        color: step.color,
      };
    });

  const frames = drawFrames(id, title ?? `Waterfall of ${columnLabel(value, undefined)} by ${columnLabel(label, undefined)}`, (frame) =>
    createChartScene(
      defineChart({
        focus: false,
        marks: [
          barY(steps, {
            x: "step",
            y1: "start",
            y2: "end",
            fill: (step) => step.color,
            radius: 2,
            maxThickness: frame.name === "compact" ? 26 : 40,
          }),
          text(steps, {
            x: "step",
            y: (step) => Math.max(step.start, step.end),
            text: (step) => (step.kind === "total" ? format(step.end) : signed(step.delta)),
            dy: -10,
            fontSize: frame.tickSize,
            fontWeight: 600,
            fill: "currentColor",
          }),
        ],
        scales: {
          x: {
            scale: () => scaleBand<string>().domain(categories).padding(0.22),
            axis: { ticks: { line: false }, tickLabels: { fontSize: frame.tickSize } },
          },
          y: {
            scale: scaleLinear,
            nice: true,
            grid: true,
            axis: { line: false, ticks: { line: false, count: 5, format }, tickLabels: { fontSize: frame.tickSize } },
          },
        },
      }),
      { width: frame.width, height: HEIGHT[frame.name] },
    ),
    hits,
  );

  return (
    <ChartFigure
      kind="waterfall"
      title={title}
      caption={caption}
      legend={kinds.map((kind) => ({ label: KIND_LABEL[kind], color: KIND_COLOR[kind], shape: "block" }))}
      frames={frames}
      data={{
        columns: [columnLabel(label, undefined), "Change", "Running total"],
        rows: steps.map((step) => [step.step, step.kind === "total" ? "" : `${step.delta > 0 ? "+" : ""}${exact(step.delta)}`, exact(step.end)]),
      }}
    />
  );
}
