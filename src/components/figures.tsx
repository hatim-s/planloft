import type { ReactNode } from "react";
import { ComponentInputError, resolveFormatting, type ValueFormatting } from "./data.js";
import { Sparkline } from "./sparkline.js";

export interface StatProps extends ValueFormatting {
  label: string;
  /** A number is formatted with `format`; a string is shown as written. */
  value: number | string;
  /** Change against the comparison period, such as 0.12 with `changeFormat="percent"` or "+4 pts". */
  change?: number | string;
  changeFormat?: ValueFormatting["format"];
  /** Which direction counts as good. Defaults to up. */
  good?: "up" | "down";
  /** What the change is measured against, such as "vs September". */
  period?: string;
  /** Recent values drawn as a sparkline under the figure. */
  trend?: readonly number[];
  children?: ReactNode;
}

export function Stat({ label, value, change, changeFormat, good = "up", period, trend, children, ...formatting }: StatProps) {
  const format = resolveFormatting("Stat", formatting).table;
  const shown = typeof value === "number" ? format(value) : value;
  const changeFormatter = resolveFormatting("Stat", {
    ...formatting, format: changeFormat ?? formatting.format, unit: (changeFormat ?? formatting.format) === "percent" ? undefined : formatting.unit,
  }).table;
  const delta = change === undefined ? undefined : describeChange(change, changeFormatter);
  const assessment = delta?.direction === "up" || delta?.direction === "down" ? (delta.direction === good ? "good" : "bad") : "neutral";
  return (
    <div className="pl-stat">
      <p className="pl-stat__label">{label}</p>
      <p className="pl-stat__value">{shown}</p>
      {delta ? (
        <p className="pl-stat__change" data-assessment={assessment}>
          {delta.direction ? <>
            <span className="pl-stat__arrow" aria-hidden="true">{ARROW[delta.direction]}</span>
            <span className="pl-sr">{DIRECTION_WORD[delta.direction]} </span>
          </> : null}
          {delta.text}
          {period ? <span className="pl-stat__period"> {period}</span> : null}
        </p>
      ) : null}
      {trend ? <Sparkline values={trend} label={`${label} trend`} {...formatting} /> : null}
      {children ? <div className="pl-stat__note">{children}</div> : null}
    </div>
  );
}

const ARROW = { up: "↗", down: "↘", flat: "→" } as const;
const DIRECTION_WORD = { up: "Up", down: "Down", flat: "Unchanged" } as const;

function describeChange(change: number | string, format: (value: number) => string) {
  if (typeof change === "number") {
    const direction = change > 0 ? "up" : change < 0 ? "down" : "flat";
    const magnitude = format(Math.abs(change));
    return { direction, text: `${change > 0 ? "+" : change < 0 ? "−" : ""}${magnitude}` } as const;
  }
  const trimmed = change.trim();
  const direction = /^[+−-]?0(?:\.0+)?(?:$|\s|%)/.test(trimmed) ? "flat" : /^[-−]/.test(trimmed) ? "down" : /^\+/.test(trimmed) ? "up" : null;
  return { direction, text: trimmed.replace(/^-/, "−") } as const;
}

export interface StatsProps {
  children: ReactNode;
}

/** A row of figures that wraps to fit the page. */
export function Stats({ children }: StatsProps) {
  return <div className="pl-stats">{children}</div>;
}

export const STATUS_TONES = ["done", "on-track", "at-risk", "blocked", "not-started"] as const;
export type StatusTone = (typeof STATUS_TONES)[number];

const STATUS_NAME: Record<StatusTone, string> = {
  done: "Done",
  "on-track": "On track",
  "at-risk": "At risk",
  blocked: "Blocked",
  "not-started": "Not started",
};

export interface StatusProps {
  tone: StatusTone;
  /** Replaces the tone's default wording. */
  children?: ReactNode;
}

/** An inline state marker. Each tone has its own glyph as well as its colour. */
export function Status({ tone, children }: StatusProps) {
  if (!STATUS_TONES.includes(tone)) {
    throw new ComponentInputError("Status", `tone must be one of ${STATUS_TONES.join(", ")}.`);
  }
  return (
    <span className="pl-status" data-tone={tone}>
      {children ?? STATUS_NAME[tone]}
    </span>
  );
}
