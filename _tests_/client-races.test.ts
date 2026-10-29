import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Note, Task } from '../src/collaboration/contracts.js';
import type { Result } from '../src/collaboration/ui/api.js';
import { NoteEditing } from '../src/collaboration/ui/notes.js';
import type { NoteEdit, Notice } from '../src/collaboration/ui/state.js';
import { TaskSaves } from '../src/collaboration/ui/task-saves.js';

// Requests whose responses the test releases one at a time, in any order.
function controlled<T>() {
  const pending: { args: unknown[]; resolve: (value: T) => void }[] = [];
  const call = (...args: unknown[]) => new Promise<T>(resolve => pending.push({ args, resolve }));
  return { call, pending };
}
const settle = () => new Promise(resolve => setImmediate(resolve));

function notesHarness() {
  const original: Note = { id: 'n', body: 'original', version: 1, createdAt: 't0', updatedAt: 't0' };
  const state = { notes: [original], noteEdits: new Map<string, NoteEdit>() };
  const requests = controlled<Result<Note, Note>>();
  const notices: Omit<Notice, 'id'>[] = [];
  const editing = new NoteEditing({
    state,
    api: { updateNote: requests.call },
    render: () => {},
    announce: () => {},
    notify: notice => notices.push(notice),
  });
  // Save "first save", then cancel and reopen with a new unsaved draft while it is in flight.
  editing.begin('n');
  editing.setDraft('n', 'first save');
  const saving = editing.save('n');
  editing.close('n');
  editing.begin('n');
  editing.setDraft('n', 'new unsaved draft');
  const reopened = state.noteEdits.get('n')!;
  return { state, requests, notices, saving, reopened, original };
}

test('an old note save that succeeds leaves the reopened editor and its draft alone', async () => {
  const { state, requests, saving, reopened, original } = notesHarness();
  requests.pending[0]!.resolve({ ok: true, value: { ...original, body: 'first save', version: 2 } });
  await saving;
  assert.equal(state.noteEdits.get('n'), reopened);
  assert.equal(reopened.draft, 'new unsaved draft');
  assert.equal(reopened.conflict, null);
  // The saved list still learns about the save, so the reopened draft will meet a conflict, not overwrite it.
  assert.equal(state.notes[0]!.version, 2);
});

test('an old note conflict or failure does not mark the reopened editor', async () => {
  const conflict = notesHarness();
  const theirs: Note = { ...conflict.original, body: 'someone else', version: 2 };
  conflict.requests.pending[0]!.resolve({ ok: false, failure: { kind: 'conflict', current: theirs } });
  await conflict.saving;
  assert.equal(conflict.reopened.conflict, null);
  assert.equal(conflict.reopened.draft, 'new unsaved draft');
  assert.equal(conflict.state.notes[0]!.body, 'someone else');

  const failure = notesHarness();
  failure.requests.pending[0]!.resolve({ ok: false, failure: { kind: 'network' } });
  await failure.saving;
  assert.equal(failure.reopened.failure, null);
  assert.equal(failure.state.noteEdits.get('n'), failure.reopened);
  // The closed editor's failure is still reported, as uncertain.
  assert.equal(failure.notices.length, 1);
  assert.match(failure.notices[0]!.message, /closed while saving may not have saved/);
});

test('a conflict on the active editor keeps the draft and shows their version', async () => {
  const original: Note = { id: 'n', body: 'original', version: 1, createdAt: 't0', updatedAt: 't0' };
  const state = { notes: [original], noteEdits: new Map<string, NoteEdit>() };
  const requests = controlled<Result<Note, Note>>();
  const editing = new NoteEditing({ state, api: { updateNote: requests.call }, render: () => {}, announce: () => {}, notify: () => 0 });
  editing.begin('n');
  editing.setDraft('n', 'mine');
  const saving = editing.save('n');
  const theirs: Note = { ...original, body: 'theirs', version: 2 };
  requests.pending[0]!.resolve({ ok: false, failure: { kind: 'conflict', current: theirs } });
  await saving;
  const edit = state.noteEdits.get('n')!;
  assert.equal(edit.draft, 'mine');
  assert.deepEqual(edit.conflict, theirs);
  // Overwrite resends the draft against the version the reader has now seen.
  editing.overwrite('n');
  assert.deepEqual(requests.pending[1]!.args, ['n', 'mine', 2]);
});

test('a late, older note response never replaces a newer saved version in the list', async () => {
  const { state, requests, saving, original } = notesHarness();
  state.notes[0] = { ...original, body: 'newer', version: 3 };
  requests.pending[0]!.resolve({ ok: true, value: { ...original, body: 'first save', version: 2 } });
  await saving;
  assert.equal(state.notes[0]!.body, 'newer');
});

function tasksHarness() {
  const state = { tasks: new Map<string, Task>() };
  const requests = controlled<Result<Task, Task>>();
  const notices = new Map<number, Omit<Notice, 'id'>>();
  let nextNotice = 1;
  const saves = new TaskSaves({
    state,
    api: { setTask: requests.call },
    notify: notice => {
      notices.set(nextNotice, notice);
      return nextNotice++;
    },
    dismiss: id => notices.delete(id),
    changed: () => {},
  });
  return { state, requests, notices, saves };
}

test('a stale task retry cannot undo a newer confirmed choice', async () => {
  const { state, requests, notices, saves } = tasksHarness();
  const failed = saves.toggle('t', true, 'Task');
  requests.pending[0]!.resolve({ ok: false, failure: { kind: 'network' } });
  await failed;
  const [retry] = [...notices.values()];
  assert.ok(retry?.action);

  const checked = saves.toggle('t', true, 'Task');
  requests.pending[1]!.resolve({ ok: true, value: { key: 't', checked: true, version: 1 } });
  await checked;
  const unchecked = saves.toggle('t', false, 'Task');
  requests.pending[2]!.resolve({ ok: true, value: { key: 't', checked: false, version: 2 } });
  await unchecked;

  // The newer save dismissed the old notice; running its action anyway sends nothing.
  assert.equal(notices.size, 0);
  retry.action.run();
  await settle();
  assert.equal(requests.pending.length, 3);
  assert.deepEqual(state.tasks.get('t'), { key: 't', checked: false, version: 2 });
});

test('a task retry or second toggle never runs alongside an active save for the same key', async () => {
  const { requests, notices, saves } = tasksHarness();
  const failed = saves.toggle('t', true, 'Task');
  requests.pending[0]!.resolve({ ok: false, failure: { kind: 'status', status: 500, code: null } });
  await failed;
  const [retry] = [...notices.values()];
  void saves.toggle('t', false, 'Task');
  assert.equal(saves.saving('t'), false);
  retry!.action!.run();
  void saves.toggle('t', true, 'Task');
  await settle();
  assert.equal(requests.pending.length, 2);
});

test('a current task retry resends its original version so a newer server change wins as a conflict', async () => {
  const { state, requests, notices, saves } = tasksHarness();
  state.tasks.set('t', { key: 't', checked: false, version: 4 });
  const failed = saves.toggle('t', true, 'Task');
  requests.pending[0]!.resolve({ ok: false, failure: { kind: 'network' } });
  await failed;
  // A reload after reconnecting brings in another reader's newer change before the retry.
  state.tasks.set('t', { key: 't', checked: false, version: 6 });
  [...notices.values()][0]!.action!.run();
  await settle();
  assert.deepEqual(requests.pending[1]!.args, ['t', true, 4]);
  requests.pending[1]!.resolve({ ok: false, failure: { kind: 'conflict', current: { key: 't', checked: false, version: 6 } } });
  await settle();
  assert.deepEqual(state.tasks.get('t'), { key: 't', checked: false, version: 6 });
  assert.match([...notices.values()].at(-1)!.message, /Someone else changed “Task” first/);
});
