import type { ReactNode } from "react";
import { ComponentInputError } from "./data.js";

export const BADGE_COLORS = ["gray", "red", "orange", "yellow", "green", "teal", "blue", "purple", "pink", "accent"] as const;
export type BadgeColor = (typeof BADGE_COLORS)[number];

export interface BadgeProps {
  /** Defaults to gray. `accent` follows the theme's accent colour. */
  color?: BadgeColor;
  children: ReactNode;
}

/** A coloured label pill for prose and table cells. The label carries the meaning; colour only groups. */
export function Badge({ color = "gray", children }: BadgeProps) {
  if (!isBadgeColor(color)) {
    throw new ComponentInputError("Badge", `color must be one of ${BADGE_COLORS.join(", ")}.`);
  }
  return <span className="pl-badge" data-color={color}>{children}</span>;
}

export function isBadgeColor(value: string): value is BadgeColor {
  return BADGE_COLORS.some((color) => color === value);
}

// Each colour is one mid-tone hue. The text mixes it toward the theme's ink and the fill
// toward its paper, so a hue reads dark-on-pale in a light theme and light-on-deep in a
// dark one, and follows a region that overrides `--planloft-paper` or `--planloft-ink`.
// At these ratios every fixed hue keeps at least 5.3:1 against its fill on white, #111,
// and the editorial theme's warm light and dark papers. Gray and accent take the theme's
// own muted and accent colours, which themes already tune per scheme.
//
// An inline-block moves to the next line whole and only wraps inside itself when the
// label is wider than its container, which keeps narrow table cells readable.
export const badgeStyles = String.raw`
/* Badge */
.pl-badge {
  --pl-badge-hue: var(--pl-muted);
  box-sizing: border-box;
  display: inline-block;
  max-width: 100%;
  padding: 0.04em 0.6em 0.08em;
  border: 1px solid color-mix(in oklab, var(--pl-badge-hue) 30%, var(--pl-paper));
  border-radius: 0.8em;
  background: color-mix(in oklab, var(--pl-badge-hue) 14%, var(--pl-paper));
  color: color-mix(in oklab, var(--pl-badge-hue) 55%, var(--pl-ink));
  font-family: var(--pl-font-body);
  font-size: 0.78em;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.01em;
  line-height: 1.4;
  overflow-wrap: anywhere;
}
.pl-badge[data-color="red"] { --pl-badge-hue: #d1453b; }
.pl-badge[data-color="orange"] { --pl-badge-hue: #dd7020; }
.pl-badge[data-color="yellow"] { --pl-badge-hue: #b98d00; }
.pl-badge[data-color="green"] { --pl-badge-hue: #2f9a4e; }
.pl-badge[data-color="teal"] { --pl-badge-hue: #17958f; }
.pl-badge[data-color="blue"] { --pl-badge-hue: #2f74d0; }
.pl-badge[data-color="purple"] { --pl-badge-hue: #7a55d4; }
.pl-badge[data-color="pink"] { --pl-badge-hue: #d24f8e; }
.pl-badge[data-color="accent"] { --pl-badge-hue: var(--pl-accent); }
@media (forced-colors: active) {
  .pl-badge { border-color: CanvasText; }
}
`;
