import type { Note } from '../contracts.js';
import { describeFailure, mayHaveSaved, type Api } from './api.js';
import type { Notice, State } from './state.js';

type Host = {
  state: Pick<State, 'notes' | 'noteEdits'>;
  api: Pick<Api, 'updateNote'>;
  render(): void;
  announce(message: string): void;
  notify(notice: Omit<Notice, 'id'>): number;
};

/**
 * Note editing with version checks. A save response only touches the editor that sent
 * it: if the reader cancelled or reopened the note meanwhile, the response updates the
 * saved note list and leaves the newer editor and its draft alone. Kept free of DOM
 * access so the async interleavings can be tested directly.
 */
export class NoteEditing {
  constructor(private readonly host: Host) {}

  begin(id: string): boolean {
    const note = this.host.state.notes.find(item => item.id === id);
    if (!note) return false;
    this.host.state.noteEdits.set(id, { draft: note.body, base: note, saving: false, failure: null, conflict: null });
    this.host.render();
    return true;
  }

  setDraft(id: string, draft: string): void {
    const edit = this.host.state.noteEdits.get(id);
    if (edit) edit.draft = draft;
  }

  /** Closes the editor. A save already in flight still lands on the server. */
  close(id: string): void {
    this.host.state.noteEdits.delete(id);
    this.host.render();
  }

  async save(id: string): Promise<void> {
    const edit = this.host.state.noteEdits.get(id);
    if (!edit || edit.saving) return;
    if (!edit.draft.trim()) {
      edit.failure = { kind: 'blank' };
      this.host.announce('A note needs some text.');
      return this.host.render();
    }
    Object.assign(edit, { saving: true, failure: null });
    this.host.render();
    const draft = edit.draft;
    const result = await this.host.api.updateNote(id, draft, edit.base.version);
    edit.saving = false;
    const active = this.host.state.noteEdits.get(id) === edit;
    // A conflict whose saved text is this draft means an earlier, unconfirmed attempt landed.
    const saved = result.ok ? result.value
      : result.failure.kind === 'conflict' && result.failure.current.body === draft ? result.failure.current
      : null;
    if (saved) {
      this.adopt(saved);
      if (active && edit.draft === draft) this.host.state.noteEdits.delete(id);
      else if (active) Object.assign(edit, { base: saved, conflict: null });
      this.host.announce('Note saved.');
    } else if (!result.ok && result.failure.kind === 'conflict') {
      this.adopt(result.failure.current);
      if (active) {
        edit.conflict = result.failure.current;
        this.host.announce('Someone saved a newer version of this note. Your text is still in the editor.');
      }
    } else if (!result.ok) {
      if (active) {
        edit.failure = result.failure;
        this.host.announce(`Note not saved. ${describeFailure(result.failure)}`);
      } else {
        // The reader closed this editor while it was saving, so the panel can no longer show the failure.
        const outcome = mayHaveSaved(result.failure) ? 'may not have saved' : 'was not saved';
        this.host.notify({ tone: 'error', message: `A note edit you closed while saving ${outcome}. ${describeFailure(result.failure)}` });
      }
    }
    this.host.render();
  }

  /** Saves the reader's draft over the newer version they have now seen. */
  overwrite(id: string): void {
    const edit = this.host.state.noteEdits.get(id);
    if (!edit?.conflict || edit.saving) return;
    Object.assign(edit, { base: edit.conflict, conflict: null });
    void this.save(id);
  }

  /** Keeps a saved note unless the list already holds a newer version of it. */
  adopt(note: Note): void {
    const notes = this.host.state.notes;
    const index = notes.findIndex(item => item.id === note.id);
    if (index < 0) notes.push(note);
    else if (notes[index]!.version <= note.version) notes[index] = note;
  }
}
