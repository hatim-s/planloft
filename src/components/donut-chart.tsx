import { createChartScene, defineChart } from "@tanstack/charts";
import { pie, polar, radialArc } from "@tanstack/charts/polar";
import type { ReactNode } from "react";
import { ChartFigure, drawScene, markHits, requireSeriesCount, seriesColor, useChartId } from "./chart-frame.js";
import {
  columnLabel,
  ComponentInputError,
  exactCell,
  exactNumberFormatter,
  numberFormatter,
  numericCell,
  requireKeys,
  requireRows,
  textCell,
  type Row,
  type ValueFormatting,
} from "./data.js";

export interface DonutChartProps extends ValueFormatting {
  data: readonly Row[];
  /** Slice name column. */
  label: string;
  /** Slice size column. */
  value: string;
  title?: string;
  caption?: ReactNode;
  /** Text under the total in the middle of the ring. */
  centerLabel?: string;
}

const SIZE = 220;

export function DonutChart({ data, label, value, title, caption, centerLabel = "Total", ...formatting }: DonutChartProps) {
  const rows = requireRows("DonutChart", data);
  requireKeys("DonutChart", rows, [label, value]);
  requireSeriesCount("DonutChart", rows.length);

  const id = useChartId();
  const format = numberFormatter(formatting);
  const exact = exactNumberFormatter(formatting);
  const slices = rows.map((row, index) => {
    const amount = numericCell(row, value);
    if (amount === null || amount < 0) {
      throw new ComponentInputError("DonutChart", `needs a non-negative numeric value for "${value}" in row ${index + 1}.`);
    }
    return { name: textCell(row, label), amount };
  });
  const sum = slices.reduce((total, slice) => total + slice.amount, 0);
  const share = new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 0 });
  const names = slices.map((slice) => slice.name);
  const shareOf = (slice: { amount: number }) => share.format(sum === 0 ? 0 : slice.amount / sum);
  // Arcs come out of `pie` in slice order, so an arc's datum index is its slice index.
  const arcs = pie(slices, { value: "amount", gapAngle: 0.025 });
  // The ring has no text of its own, so one drawing serves every width.
  const scene = createChartScene(
    defineChart({
      focus: false,
      marks: [
        polar({
          inset: 2,
          marks: [
            radialArc(arcs, {
              innerRadius: ({ radius }) => radius * 0.64,
              cornerRadius: 2,
              color: "name",
              key: "name",
            }),
          ],
          scales: { angle: null, radius: null },
        }),
      ],
      scales: { x: null, y: null },
      color: { domain: names, range: names.map((_, index) => seriesColor(index)) },
    }),
    { width: SIZE, height: SIZE },
  );
  const markup = drawScene(scene, {
    ariaLabel: title ?? `Donut chart of ${columnLabel(value, undefined)} by ${columnLabel(label, undefined)}`,
    idPrefix: id,
    className: "pl-chart__svg",
    hits: {
      expose: true,
      items: markHits(scene, (index) => {
        const slice = slices[index]!;
        return {
          title: slice.name,
          rows: [[columnLabel(value, undefined), exact(slice.amount)], ["Share", shareOf(slice)]],
          color: seriesColor(index),
        };
      }),
    },
  });

  return (
    <ChartFigure
      kind="donut"
      title={title}
      caption={caption}
      legend={slices.map((slice, index) => ({
        label: slice.name,
        color: seriesColor(index),
        shape: "block",
        value: `${format(slice.amount)} · ${shareOf(slice)}`,
      }))}
      frames={[{ name: "fixed", markup }]}
      overlay={
        <p className="pl-chart__center" aria-hidden="true">
          <span className="pl-chart__center-value">{format(sum)}</span>
          <span className="pl-chart__center-label">{centerLabel}</span>
        </p>
      }
      data={{
        columns: [columnLabel(label, undefined), columnLabel(value, undefined), "Share"],
        rows: slices.map((slice) => [slice.name, exactCell(slice.amount), shareOf(slice)]),
      }}
    />
  );
}
