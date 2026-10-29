import { areaY, createChartScene, defineChart, dot, lineY } from "@tanstack/charts";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import { columnHits, drawScene, useChartId } from "./chart-frame.js";
import { ComponentInputError, resolveFormatting, type ValueFormatting } from "./data.js";

export interface SparklineProps extends ValueFormatting {
  values: readonly number[];
  /** What the values measure, used in the accessible description. */
  label?: string;
}

const WIDTH = 96;
const HEIGHT = 24;

/** A word-sized trend line that sits inline with text or inside a Stat. */
export function Sparkline({ values, label = "Trend", ...formatting }: SparklineProps) {
  if (!Array.isArray(values) || values.length < 2 || values.some((value) => !Number.isFinite(value))) {
    throw new ComponentInputError("Sparkline", "needs `values` with at least two numbers.", "invalid_value");
  }
  const id = useChartId();
  const { axis: format, exact } = resolveFormatting("Sparkline", formatting);
  const points = values.map((value, index) => ({ index, value }));
  const last = points.slice(-1);
  const scene = createChartScene(
    defineChart({
      focus: false,
      marks: [
        areaY(points, { x: "index", y: "value", y1: Math.min(...values), fill: `url(#${id}-fill)`, fillOpacity: 1 }),
        lineY(points, { x: "index", y: "value", stroke: "currentColor", strokeWidth: 1.5 }),
        dot(last, { x: "index", y: "value", r: 2.5, fill: "var(--pl-accent)", stroke: "var(--pl-paper)", strokeWidth: 1 }),
      ],
      scales: { x: { scale: scaleLinear }, y: { scale: scaleLinear } },
      guides: false,
      margin: 3,
      gradients: [{
        id: `${id}-fill`,
        x1: 0, y1: 0, x2: 0, y2: 1,
        stops: [{ offset: 0, color: "currentColor", opacity: 0.18 }, { offset: 1, color: "currentColor", opacity: 0 }],
      }],
    }),
    { width: WIDTH, height: HEIGHT },
  );
  // Hover only: a word-sized trend is summarised by its label, not one stop per point.
  const markup = drawScene(scene, {
    ariaLabel: `${label}: ${values.length} points from ${format(values[0]!)} to ${format(values.at(-1)!)}`,
    idPrefix: id,
    className: "pl-sparkline__svg",
    hits: {
      expose: false,
      items: columnHits(scene, points.map((point) => point.index), (index) => ({
        title: `Point ${index + 1} of ${values.length}`,
        rows: [[label, exact(values[index]!)]],
      })),
    },
  });
  return <span className="pl-sparkline" dangerouslySetInnerHTML={{ __html: markup }} />;
}
