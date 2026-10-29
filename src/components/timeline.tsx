import type { ReactNode } from "react";
import { ComponentInputError } from "./data.js";

export const MILESTONE_STATES = ["done", "active", "planned", "blocked"] as const;
export type MilestoneState = (typeof MILESTONE_STATES)[number];

const STATE_NAME: Record<MilestoneState, string> = {
  done: "Done",
  active: "In progress",
  planned: "Planned",
  blocked: "Blocked",
};

export interface TimelineProps {
  children: ReactNode;
}

/** An ordered run of milestones. Order is the author's; dates are labels, not sort keys. */
export function Timeline({ children }: TimelineProps) {
  return <ol className="pl-timeline">{children}</ol>;
}

export interface MilestoneProps {
  title: string;
  /** Free text: "Nov 4", "Week 3", "Q1 2027". */
  date?: string;
  state?: MilestoneState;
  children?: ReactNode;
}

export function Milestone({ title, date, state = "planned", children }: MilestoneProps) {
  if (!MILESTONE_STATES.includes(state)) {
    throw new ComponentInputError("Milestone", `state must be one of ${MILESTONE_STATES.join(", ")}.`);
  }
  return (
    <li className="pl-milestone" data-state={state}>
      <span className="pl-milestone__node" aria-hidden="true" />
      <div className="pl-milestone__head">
        {date ? <span className="pl-milestone__date">{date}</span> : null}
        <span className="pl-milestone__title">{title}</span>
        <span className="pl-milestone__state">{STATE_NAME[state]}</span>
      </div>
      {children ? <div className="pl-milestone__body">{children}</div> : null}
    </li>
  );
}
