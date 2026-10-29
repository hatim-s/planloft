import { useId, type ReactNode } from "react";
import { ComponentInputError } from "./data.js";
import { TASK_KEY } from "../collaboration/contracts.js";

export interface TodoProps {
  /**
   * Stable key for this task's shared state. Keep it when the wording changes;
   * a new key starts a new, unchecked task.
   */
  task: string;
  /** Short task text. Without it, the children are the task text. */
  label?: string;
  /** State before anyone has toggled the task in a shared copy. */
  checked?: boolean;
  owner?: string;
  due?: string;
  children?: ReactNode;
}



/**
 * A checkbox whose state the collaboration runtime owns. Rendered pages ship it
 * disabled; the runtime enables it once shared task state has loaded, so a page
 * without collaboration never shows a checkbox that forgets its state.
 */
export function Todo({ task, label, checked = false, owner, due, children }: TodoProps) {
  if (typeof task !== "string" || !TASK_KEY.test(task)) {
    throw new ComponentInputError(
      "Todo",
      `needs a stable \`task\` key of letters, digits, ".", "_", ":" or "-" (got ${JSON.stringify(task)}).`,
    );
  }
  if (!label && !children) throw new ComponentInputError("Todo", `"${task}" needs a \`label\` or children.`);
  const inputId = `planloft-task-${useId()}`;
  return (
    <div className="pl-todo">
      <input
        type="checkbox"
        id={inputId}
        className="pl-todo__box"
        data-planloft-task={task}
        defaultChecked={checked}
        disabled
      />
      <div className="pl-todo__text">
        <label htmlFor={inputId} className="pl-todo__label">{label ?? children}</label>
        {owner || due ? (
          <span className="pl-todo__meta">
            {owner ? <span className="pl-todo__owner">{owner}</span> : null}
            {due ? <span className="pl-todo__due">Due {due}</span> : null}
          </span>
        ) : null}
        {label && children ? <div className="pl-todo__detail">{children}</div> : null}
      </div>
    </div>
  );
}

export interface ChecklistProps {
  title?: string;
  children: ReactNode;
}

export function Checklist({ title, children }: ChecklistProps) {
  return (
    <section className="pl-checklist" aria-label={title ?? "Checklist"}>
      {title ? <p className="pl-checklist__title">{title}</p> : null}
      {children}
    </section>
  );
}
