import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import type { Note, Task } from '../src/collaboration/contracts.js';
import { migrate, sqliteDatabase } from '../src/collaboration/database.js';
import { createCollaborationService } from '../src/collaboration/service.js';
import { createApi, idempotencyKey, type Result } from '../src/collaboration/ui/api.js';
import { changesContent } from '../src/collaboration/ui/dom-text.js';
import { NoteEditing } from '../src/collaboration/ui/notes.js';
import { parse } from '../src/collaboration/ui/parse.js';
import { deliver, replySending, type Delivery, type NoteEdit, type Notice, type PendingNote, type PendingReply, type PendingThread } from '../src/collaboration/ui/state.js';
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

test('a blank note edit is held in the editor and never sent', async () => {
  const original: Note = { id: 'n', body: 'original', version: 1, createdAt: 't0', updatedAt: 't0' };
  const state = { notes: [original], noteEdits: new Map<string, NoteEdit>() };
  const requests = controlled<Result<Note, Note>>();
  const editing = new NoteEditing({ state, api: { updateNote: requests.call }, render: () => {}, announce: () => {}, notify: () => 0 });
  editing.begin('n');
  editing.setDraft('n', '  \n ');
  await editing.save('n');
  assert.equal(requests.pending.length, 0);
  assert.deepEqual(state.noteEdits.get('n')?.failure, { kind: 'blank' });
  assert.equal(state.notes[0]!.body, 'original');
});

// The real service on SQLite behind the real client transport. `respond` decides what the
// client sees for each request after the service has handled it, or instead of calling it.
async function creationHarness() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');
  const db = sqliteDatabase(sqlite);
  await migrate(db);
  const service = createCollaborationService(db, 'secret');
  await service(new Request('http://local/documents/doc', { method: 'PUT', headers: { Authorization: 'Bearer secret' }, body: JSON.stringify({ revision: '1' }) }));
  type Outcome = 'deliver' | 'lose' | 'unreadable' | 'server-error' | 'refuse' | 'offline';
  const outcomes: Outcome[] = [];
  let online = true;
  Object.defineProperty(globalThis.navigator, 'onLine', { configurable: true, get: () => online });
  globalThis.fetch = async (input, init) => {
    const outcome = outcomes.shift() ?? 'deliver';
    if (outcome === 'refuse') return new Response(JSON.stringify({ error: 'invalid_request' }), { status: 400 });
    const response = await service(new Request(input, init));
    if (outcome === 'lose') throw new TypeError('Failed to fetch');
    if (outcome === 'unreadable') return new Response('<html>proxy page</html>', { status: 201 });
    if (outcome === 'server-error') return new Response(JSON.stringify({ error: 'internal' }), { status: 503 });
    return response;
  };
  const api = createApi({ documentId: 'doc', revision: '1', apiUrl: 'http://local' });
  const send = async <T>(pending: { delivery: Delivery }, next: Outcome, request: () => Promise<Result<T>>) => {
    online = next !== 'offline';
    if (next !== 'offline') outcomes.push(next);
    const value = await deliver(pending, request);
    online = true;
    return value;
  };
  const state = async () => parse.state(await (await service(new Request('http://local/documents/doc/state'))).json());
  return { api, send, state, close: () => sqlite.close() };
}

test('a creation that may have been saved stays unknown until a retry with its original key settles it', async () => {
  const { api, send, state, close } = await creationHarness();
  try {
    const thread: PendingThread = { key: idempotencyKey(), body: 'Original comment', anchor: null, delivery: { status: 'sending' } };
    const post = () => api.createThread(thread.body, thread.anchor, thread.key);
    // The server saves it, but the response is lost: Edit would post a second copy.
    assert.equal(await send(thread, 'lose', post), null);
    assert.equal(thread.delivery.status, 'unknown');
    assert.equal((await state()).threads.length, 1);
    // A retry that never leaves the browser cannot make the outcome certain.
    assert.equal(await send(thread, 'offline', post), null);
    assert.deepEqual(thread.delivery, { status: 'unknown', failure: { kind: 'offline' } });
    // Unreadable successes and server failures may also have saved.
    assert.equal(await send(thread, 'unreadable', post), null);
    assert.equal(thread.delivery.status, 'unknown');
    assert.equal(await send(thread, 'server-error', post), null);
    assert.equal(thread.delivery.status, 'unknown');
    const saved = await send(thread, 'deliver', post);
    assert.deepEqual((await state()).threads.map(item => [item.id, item.body]), [[saved?.id, 'Original comment']]);

    const reply: PendingReply = { key: idempotencyKey(), threadId: saved!.id, body: 'Original reply', delivery: { status: 'sending' } };
    const postReply = () => api.reply(reply.threadId, reply.body, reply.key);
    const held = send(reply, 'server-error', postReply);
    // A thread update waits while the reply sends, so its reply list cannot be stale.
    assert.equal(replySending({ pendingReplies: [reply] }, reply.threadId), true);
    assert.equal(await held, null);
    assert.equal(replySending({ pendingReplies: [reply] }, reply.threadId), false);
    assert.equal(reply.delivery.status, 'unknown');
    const savedReply = await send(reply, 'deliver', postReply);
    assert.deepEqual((await state()).threads[0]!.comments.map(item => [item.id, item.body]), [[savedReply?.id, 'Original reply']]);

    const note: PendingNote = { key: idempotencyKey(), body: 'Original note', delivery: { status: 'sending' } };
    const postNote = () => api.createNote(note.body, note.key);
    assert.equal(await send(note, 'lose', postNote), null);
    assert.equal(note.delivery.status, 'unknown');
    await send(note, 'deliver', postNote);
    assert.deepEqual((await state()).notes.map(item => item.body), ['Original note']);
  } finally { close(); }
});

test('only a creation the server refused, or one never sent, can go back to the composer', async () => {
  const { api, send, state, close } = await creationHarness();
  try {
    const refused: PendingNote = { key: idempotencyKey(), body: 'Refused note', delivery: { status: 'sending' } };
    assert.equal(await send(refused, 'refuse', () => api.createNote(refused.body, refused.key)), null);
    assert.equal(refused.delivery.status, 'failed');
    const unsent: PendingNote = { key: idempotencyKey(), body: 'Unsent note', delivery: { status: 'sending' } };
    assert.equal(await send(unsent, 'offline', () => api.createNote(unsent.body, unsent.key)), null);
    assert.deepEqual(unsent.delivery, { status: 'failed', failure: { kind: 'offline' } });
    assert.deepEqual((await state()).notes, []);
  } finally { close(); }
});

// Minimal element tree for the mutation filter, matching attribute selectors the way the DOM does.
class FakeElement {
  constructor(readonly attributes: string[], readonly parentElement: FakeElement | null = null) {}
  matches(selectors: string): boolean {
    return selectors.split(',').some(selector => {
      const attribute = /^\s*\[([\w-]+)\]\s*$/.exec(selector)?.[1];
      return attribute !== undefined && this.attributes.includes(attribute);
    });
  }
  closest(selectors: string): FakeElement | null {
    return this.matches(selectors) ? this : this.parentElement?.closest(selectors) ?? null;
  }
}

test('layout ignores tooltip and runtime mutations but not content changes mixed in with them', () => {
  Object.assign(globalThis, { Element: FakeElement });
  const body = new FakeElement([]);
  const paragraph = new FakeElement([], body);
  const tip = new FakeElement(['data-planloft-ignore'], body);
  const panel = new FakeElement([], new FakeElement(['data-planloft-collaboration'], body));
  const text = (parent: FakeElement) => ({ parentElement: parent });
  const record = (type: MutationRecordType, target: unknown, added: unknown[] = [], removed: unknown[] = []) =>
    ({ type, target, addedNodes: added, removedNodes: removed }) as unknown as MutationRecord;
  // The first tooltip append is recorded on the body.
  assert.equal(changesContent(record('childList', body, [tip])), false);
  assert.equal(changesContent(record('childList', tip, [text(tip)], [text(tip)])), false);
  assert.equal(changesContent(record('characterData', text(tip))), false);
  assert.equal(changesContent(record('childList', panel, [new FakeElement([], panel)])), false);
  assert.equal(changesContent(record('childList', body, [tip, paragraph])), true);
  assert.equal(changesContent(record('childList', body, [], [paragraph])), true);
  assert.equal(changesContent(record('characterData', text(paragraph))), true);
});
