import { useId, type ReactNode } from "react";
import type { ChartScene, SceneNode } from "@tanstack/charts";
import { renderChartSvg } from "@tanstack/charts/svg";
import { ComponentInputError } from "./data.js";

// Charts are static SVG, and SVG text scales with the drawing. One drawing cannot stay
// legible from a phone to a wide monitor, so each chart is laid out three times and a
// container query shows the one whose design width is closest to the space it gets.
export const FRAMES = [
  { name: "compact", width: 340, tickSize: 12 },
  { name: "regular", width: 640, tickSize: 12 },
  { name: "wide", width: 1040, tickSize: 13 },
] as const;
export type Frame = (typeof FRAMES)[number];

export const SERIES_LIMIT = 6;
export const seriesColor = (index: number) => `var(--pl-series-${index + 1})`;

export function requireSeriesCount(component: string, count: number): void {
  if (count > SERIES_LIMIT) {
    throw new ComponentInputError(
      component,
      `plots ${count} series; the limit is ${SERIES_LIMIT}. Fold the smallest into an "Other" series or split the chart.`,
      "series_limit",
    );
  }
}

export interface DrawnFrame {
  name: Frame["name"] | "fixed";
  markup: string;
}

/**
 * What a reader learns from one mark: the category on the first line, then one
 * "label: value" row per series. The same text is the mark's accessible name, its
 * no-script tooltip, and the source the tooltip script renders from.
 */
export interface HitText {
  title: string;
  rows: readonly (readonly [label: string, value: string])[];
  /** Painted colour of the mark, shown as the tooltip's key swatch. */
  color?: string;
}

export type Hit = HitText & (
  | { shape: "rect"; x: number; y: number; width: number; height: number; column?: boolean }
  | { shape: "path"; d: string; translate: readonly [number, number] }
);

interface DrawOptions {
  ariaLabel: string;
  idPrefix: string;
  className: string;
  /** Hover-only hits are hidden from assistive tech; the drawing's own label stands. */
  hits?: { items: readonly Hit[]; expose: boolean };
}

/** Serializes a scene with TanStack's SVG renderer and appends its hit layer. */
export function drawScene(scene: ChartScene, { hits, ...options }: DrawOptions): string {
  const markup = renderChartSvg(scene, { ...options, tabIndex: -1 });
  if (!hits || hits.items.length === 0) return markup;
  // One tab stop per drawing: the first hit takes Tab and the tooltip script moves
  // focus between hits with the arrow keys, Home and End.
  const layer = hits.items.map((hit, index) => hitMarkup(hit, hits.expose && (index === 0 ? 0 : -1))).join("");
  const group = hits.expose
    ? `<g class="pl-chart__hits" role="list" data-planloft-ignore>`
    : `<g class="pl-chart__hits" aria-hidden="true" data-planloft-ignore>`;
  // Children of role="img" are presentational, so an exposed list needs a group root.
  const root = hits.expose ? markup.replace(' role="img"', ' role="group"') : markup;
  return `${root.slice(0, -"</svg>".length)}${group}${layer}</g></svg>`;
}

/** Lays a chart out once per frame. */
export function drawFrames(
  idPrefix: string,
  ariaLabel: string,
  scene: (frame: Frame) => ChartScene,
  hits?: (scene: ChartScene) => readonly Hit[],
): DrawnFrame[] {
  return FRAMES.map((frame) => {
    const drawn = scene(frame);
    return {
      name: frame.name,
      markup: drawScene(drawn, {
        ariaLabel,
        idPrefix: `${idPrefix}-${frame.name}`,
        className: "pl-chart__svg",
        hits: hits ? { items: hits(drawn), expose: true } : undefined,
      }),
    };
  });
}

function hitMarkup(hit: Hit, tabIndex: 0 | -1 | false): string {
  const text = [hit.title, ...hit.rows.map(([label, value]) => `${label}: ${value}`)].join("\n");
  const shared = `${tabIndex === false ? "" : ` role="listitem" tabindex="${tabIndex}"`}${hit.color ? ` data-pl-color="${escapeXml(hit.color)}"` : ""}`;
  const title = `<title>${escapeXml(text)}</title>`;
  if (hit.shape === "path") {
    return `<path class="pl-hit" d="${escapeXml(hit.d)}" transform="translate(${round(hit.translate[0])},${round(hit.translate[1])})"${shared}>${title}</path>`;
  }
  const className = hit.column ? "pl-hit pl-hit--column" : "pl-hit";
  return `<rect class="${className}" x="${round(hit.x)}" y="${round(hit.y)}" width="${round(hit.width)}" height="${round(hit.height)}"${shared}>${title}</rect>`;
}

/**
 * One hit per painted mark: bars, cells and arcs keep the geometry TanStack drew, so
 * the target is the mark itself in every frame, including negative and stacked bars.
 * `describe` receives the index into the array the mark was given; null skips a mark.
 */
export function markHits(scene: ChartScene, describe: (datumIndex: number) => HitText | null): Hit[] {
  const hits: Hit[] = [];
  const visit = (nodes: readonly SceneNode[], dx: number, dy: number) => {
    for (const node of nodes) {
      if (node.kind === "group") {
        visit(node.children, dx + (node.translateX ?? 0), dy + (node.translateY ?? 0));
        continue;
      }
      if (node.kind !== "rect" && node.kind !== "area") continue;
      const point = node.interaction?.point;
      if (!point) continue;
      const text = describe(point.datumIndex);
      if (!text) continue;
      if (node.kind === "rect") {
        // A bar close to zero paints as a sliver; its target still gets a few pixels.
        const width = Math.max(node.width, MIN_HIT_SIZE);
        const height = Math.max(node.height, MIN_HIT_SIZE);
        hits.push({
          ...text,
          shape: "rect",
          x: node.x + dx - (width - node.width) / 2,
          y: node.y + dy - (height - node.height) / 2,
          width,
          height,
        });
      } else if (node.path) {
        hits.push({ ...text, shape: "path", d: node.path, translate: [dx, dy] });
      }
    }
  };
  visit(scene.nodes, 0, 0);
  return hits;
}

/**
 * One full-height column per x position, split halfway to its neighbours. Lines are
 * thin targets, and a column answers for every series at once, missing values included.
 */
export function columnHits(scene: ChartScene, positions: readonly (string | number)[], describe: (index: number) => HitText): Hit[] {
  const scale = scene.scales.x;
  if (!scale) return [];
  const centers = positions.map((position) => scale.map(position));
  const { x, y, width, height } = scene.chart;
  return centers.map((center, index) => {
    const left = index === 0 ? x : (centers[index - 1]! + center) / 2;
    const right = index === centers.length - 1 ? x + width : (center + centers[index + 1]!) / 2;
    return { ...describe(index), shape: "rect", column: true, x: left, y, width: right - left, height };
  });
}

const MIN_HIT_SIZE = 4;
const round = (value: number) => Math.round(value * 100) / 100;

const XML_ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
function escapeXml(value: string): string {
  return value.replace(/[&<>"]/g, (character) => XML_ESCAPES[character] ?? character);
}

/** A document-unique prefix for SVG gradient and clip ids. */
export function useChartId(): string {
  return `pl${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
}

export interface LegendItem {
  label: string;
  color: string;
  /** The swatch matches the mark: a stroke for lines, a block for filled marks. */
  shape: "line" | "block";
  value?: string;
}

export interface DataTable {
  columns: readonly string[];
  rows: readonly (readonly string[])[];
}

interface ChartFigureProps {
  kind: string;
  title?: string;
  caption?: ReactNode;
  legend?: readonly LegendItem[];
  frames: readonly DrawnFrame[];
  /** Exact values for screen readers; the table is not laid out visually. */
  data: DataTable;
  /** Content laid over the plot, such as a donut total. */
  overlay?: ReactNode;
}

export function ChartFigure({ kind, title, caption, legend, frames, data, overlay }: ChartFigureProps) {
  const titleId = `${useChartId()}-title`;
  return (
    <figure className={`pl-chart pl-chart--${kind}`} aria-labelledby={title ? titleId : undefined}>
      {title ? <p className="pl-chart__title" id={titleId}>{title}</p> : null}
      {legend && legend.length > 0 ? <Legend items={legend} /> : null}
      <div className="pl-chart__plot">
        {frames.map((frame) => (
          <div
            key={frame.name}
            className="pl-chart__frame"
            data-frame={frame.name}
            dangerouslySetInnerHTML={{ __html: frame.markup }}
          />
        ))}
        {overlay}
      </div>
      {caption ? <figcaption className="pl-chart__caption">{caption}</figcaption> : null}
      <div className="pl-sr pl-chart__data" data-planloft-ignore="">
        <table>
          <thead>
            <tr>{data.columns.map((column) => <th key={column} scope="col">{column}</th>)}</tr>
          </thead>
          <tbody>
            {data.rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.map((cell, cellIndex) =>
                  cellIndex === 0
                    ? <th key={cellIndex} scope="row">{cell}</th>
                    : <td key={cellIndex}>{cell}</td>,
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}

export function Legend({ items }: { items: readonly LegendItem[] }) {
  return (
    <ul className="pl-legend">
      {items.map((item) => (
        <li key={item.label} className="pl-legend__item">
          <span
            className={`pl-swatch pl-swatch--${item.shape}`}
            style={{ "--pl-swatch": item.color }}
            aria-hidden="true"
          />
          <span className="pl-legend__label">{item.label}</span>
          {item.value ? <span className="pl-legend__value">{item.value}</span> : null}
        </li>
      ))}
    </ul>
  );
}
