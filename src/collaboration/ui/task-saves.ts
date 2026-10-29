import type { Task } from '../contracts.js';
import { describeFailure, type Api } from './api.js';
import type { Notice, State } from './state.js';

type Host = {
  state: Pick<State, 'tasks'>;
  api: Pick<Api, 'setTask'>;
  notify(notice: Omit<Notice, 'id'>): number;
  dismiss(id: number): void;
  /** Called whenever what a task's checkboxes should show has changed. */
  changed(key: string): void;
};

/**
 * Shared task saves, one in flight per key. Every save is a reader intent with a
 * generation; a failed save's Try again only runs while it is still the latest intent
 * for its key, and it resends the version that intent was based on. A newer choice
 * therefore either supersedes the retry or turns it into a server conflict, never an
 * overwrite. Kept free of DOM access so the interleavings can be tested directly.
 */
export class TaskSaves {
  private readonly inFlight = new Map<string, boolean>();
  private readonly intents = new Map<string, number>();
  private readonly failureNotices = new Map<string, number>();
  private nextIntent = 1;

  constructor(private readonly host: Host) {}

  /** The checked value being saved for a key, if a save is in flight. */
  saving(key: string): boolean | undefined {
    return this.inFlight.get(key);
  }

  /** Saves a reader's toggle against the version they last saw. */
  toggle(key: string, checked: boolean, name: string): Promise<void> {
    return this.save(key, checked, name, this.host.state.tasks.get(key)?.version ?? 0);
  }

  private async save(key: string, checked: boolean, name: string, version: number): Promise<void> {
    if (this.inFlight.has(key)) return this.host.changed(key);
    const intent = this.nextIntent++;
    this.intents.set(key, intent);
    const notice = this.failureNotices.get(key);
    if (notice !== undefined) {
      this.failureNotices.delete(key);
      this.host.dismiss(notice);
    }
    this.inFlight.set(key, checked);
    this.host.changed(key);
    const result = await this.host.api.setTask(key, checked, version);
    this.inFlight.delete(key);
    if (result.ok) this.adopt(result.value);
    else if (result.failure.kind === 'conflict') {
      const current = result.failure.current;
      this.adopt(current);
      if (current.checked !== checked) {
        this.host.notify({ tone: 'info', message: `Someone else changed “${name}” first. It shows their change: ${current.checked ? 'done' : 'not done'}.` });
      }
    } else {
      const failure = result.failure;
      const id = this.host.notify({
        tone: 'error',
        message: failure.kind === 'network'
          ? `“${name}” may not have saved. ${describeFailure(failure)} The box shows the last confirmed state.`
          : `“${name}” was not saved. ${describeFailure(failure)}`,
        action: {
          label: 'Try again',
          run: () => {
            if (this.intents.get(key) === intent) void this.save(key, checked, name, version);
          },
        },
      });
      this.failureNotices.set(key, id);
    }
    this.host.changed(key);
  }

  private adopt(task: Task): void {
    this.host.state.tasks.set(task.key, task);
  }
}
