import type { Api } from './api.js';
import type { Notice, State } from './state.js';
import { TaskSaves } from './task-saves.js';

const SELECTOR = 'input[type="checkbox"][data-planloft-task]';

type Host = {
  state: State;
  api: Api;
  contentRoot(): Element;
  notify(notice: Omit<Notice, 'id'>): number;
  dismiss(id: number): void;
};

function label(input: HTMLInputElement): string {
  const text = (input.closest('label')?.textContent ?? input.labels?.[0]?.textContent ?? input.getAttribute('aria-label') ?? '').replace(/\s+/g, ' ').trim();
  const name = text || input.dataset.planloftTask || 'Task';
  return name.length > 60 ? `${name.slice(0, 59)}…` : name;
}

/**
 * Binds `input[data-planloft-task]` checkboxes to shared task state. Listeners are
 * delegated from the document so checkboxes added by a later rerender work too. A
 * checkbox shows the saved state, or the change being saved; never an unsaved guess.
 */
export class TaskBinder {
  private readonly saves: TaskSaves;

  constructor(private readonly host: Host) {
    this.saves = new TaskSaves({
      state: host.state,
      api: host.api,
      notify: notice => host.notify(notice),
      dismiss: id => host.dismiss(id),
      changed: key => this.sync(key),
    });
    document.addEventListener('click', this.onClick, true);
    document.addEventListener('change', this.onChange);
  }

  private inputs(key?: string): HTMLInputElement[] {
    const all = Array.from(this.host.contentRoot().querySelectorAll<HTMLInputElement>(SELECTOR));
    return key === undefined ? all : all.filter(input => input.dataset.planloftTask === key);
  }

  private task(target: EventTarget | null): { input: HTMLInputElement; key: string } | null {
    if (!(target instanceof HTMLInputElement) || !target.matches(SELECTOR) || !this.host.contentRoot().contains(target)) return null;
    const key = target.dataset.planloftTask;
    return key ? { input: target, key } : null;
  }

  /** Applies loading, saved and saving state to every task checkbox, or to one key. */
  sync(key?: string): void {
    const { load, tasks } = this.host.state;
    for (const input of this.inputs(key)) {
      const taskKey = input.dataset.planloftTask ?? '';
      if (load.status !== 'ready') {
        input.setAttribute('aria-disabled', 'true');
        input.dataset.planloftTaskState = load.status === 'loading' ? 'loading' : 'unavailable';
        input.title = load.status === 'loading' ? 'Loading shared progress' : 'Shared progress could not be loaded';
        continue;
      }
      const saving = this.saves.saving(taskKey);
      input.disabled = false;
      input.removeAttribute('title');
      input.checked = saving ?? tasks.get(taskKey)?.checked ?? input.defaultChecked;
      input.dataset.planloftTaskState = saving === undefined ? 'ready' : 'saving';
      if (saving === undefined) {
        input.removeAttribute('aria-disabled');
        input.removeAttribute('aria-busy');
      } else {
        input.setAttribute('aria-disabled', 'true');
        input.setAttribute('aria-busy', 'true');
      }
    }
  }

  // Blocks toggles while state is unknown or a save is in flight. Space and Enter also
  // dispatch click, so this covers the keyboard too.
  private readonly onClick = (event: Event) => {
    const task = this.task(event.target);
    if (task && (this.host.state.load.status !== 'ready' || this.saves.saving(task.key) !== undefined)) event.preventDefault();
  };

  private readonly onChange = (event: Event) => {
    const task = this.task(event.target);
    if (task) void this.saves.toggle(task.key, task.input.checked, label(task.input));
  };
}
