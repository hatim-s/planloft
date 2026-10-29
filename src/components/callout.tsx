import type { ReactNode } from "react";
import { ComponentInputError } from "./data.js";

export const CALLOUT_TONES = ["note", "tip", "warning", "risk", "decision"] as const;
export type CalloutTone = (typeof CALLOUT_TONES)[number];

const TONE_NAME: Record<CalloutTone, string> = {
  note: "Note",
  tip: "Tip",
  warning: "Warning",
  risk: "Risk",
  decision: "Decision",
};

export interface CalloutProps {
  tone?: CalloutTone;
  title?: string;
  children: ReactNode;
}

/** A set-apart passage. The tone name is printed, so meaning never rests on colour. */
export function Callout({ tone = "note", title, children }: CalloutProps) {
  if (!CALLOUT_TONES.includes(tone)) {
    throw new ComponentInputError("Callout", `tone must be one of ${CALLOUT_TONES.join(", ")}.`);
  }
  return (
    <aside className="pl-callout" data-tone={tone} aria-label={title ? `${TONE_NAME[tone]}: ${title}` : TONE_NAME[tone]}>
      <p className="pl-callout__heading">
        <span className="pl-callout__tone">{TONE_NAME[tone]}</span>
        {title ? <span className="pl-callout__title">{title}</span> : null}
      </p>
      <div className="pl-callout__body">{children}</div>
    </aside>
  );
}
