import { COLLABORATION_LIMITS, InvalidResponse, requests, type CollaborationState, type Note, type TextAnchor, type Thread } from './contracts.js';
import type { Database } from './database.js';

type Row = Record<string, unknown>;
const comment = (r: Row) => ({ id: String(r.id), body: String(r.body), createdAt: String(r.created_at) });
const note = (r: Row): Note => ({ id: String(r.id), body: String(r.body), version: Number(r.version), createdAt: String(r.created_at), updatedAt: String(r.updated_at) });
const thread = (r: Row): Thread => ({ id: String(r.id), body: String(r.body), anchor: r.anchor === null ? null : JSON.parse(String(r.anchor)) as TextAnchor, resolved: !!r.resolved, createdAt: String(r.created_at), comments: [] });
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Idempotency-Key, Authorization', 'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS' };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors } });
const error = (code: string, status: number) => json({ error: code }, status);
const id = () => crypto.randomUUID();
const now = () => new Date().toISOString();
export const MAX_BODY_BYTES = 256_000;

async function readPayload(request: Request): Promise<Record<string, unknown> | Response> {
  const declared = request.headers.get('Content-Length');
  if (declared && Number(declared) > MAX_BODY_BYTES) return error('body_too_large', 413);
  const reader = request.body?.getReader();
  if (!reader) return error('invalid_request', 400);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel().catch(() => {});
        return error('body_too_large', 413);
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!value || typeof value !== 'object' || Array.isArray(value)) return error('invalid_request', 400);
    return value as Record<string, unknown>;
  } catch { return error('invalid_request', 400); }
}

/** Public document access allows every reader to comment and edit notes. Admin credentials only register documents. */
export function createCollaborationService(db: Database, adminToken?: string): (request: Request) => Promise<Response> {
  const handle = async (request: Request): Promise<Response> => {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    let path: string[];
    try { path = new URL(request.url).pathname.split('/').filter(Boolean).map(decodeURIComponent); }
    catch { return error('invalid_request', 400); }
    if (path.some(part => part.length > 1000)) return error('invalid_request', 400);
    const index = path.indexOf('documents');
    if (index < 0 || !path[index + 1]) return error('not_found', 404);
    const doc = path[index + 1]!;
    const parts = path.slice(index + 2);
    if (!parts.length && request.method === 'PUT' && !adminToken) return error('registration_disabled', 503);
    let payload: Record<string, unknown> = {};
    if (request.method !== 'GET' && request.method !== 'DELETE') {
      const value = await readPayload(request);
      if (value instanceof Response) return value;
      payload = value;
    }
    const run = (sql: string, args: (string | number | null)[] = []) => db.execute({ sql, args });
    if (!parts.length && request.method === 'PUT') {
      if (request.headers.get('Authorization') !== `Bearer ${adminToken}`) return error('unauthorized', 401);
      const revision = requests.revision(payload.revision);
      await run('INSERT INTO documents (id, revision) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET revision = excluded.revision', [doc, revision]);
      return json({ documentId: doc, revision });
    }
    if (!(await run('SELECT id FROM documents WHERE id = ?', [doc])).rows.length) return error('not_found', 404);
    if (parts[0] === 'state' && parts.length === 1 && request.method === 'GET') {
      const [threads, comments, notes, tasks] = await Promise.all([
        run('SELECT * FROM threads WHERE document_id = ? ORDER BY created_at, id', [doc]),
        run('SELECT * FROM comments WHERE document_id = ? ORDER BY created_at, id', [doc]),
        run('SELECT * FROM notes WHERE document_id = ? ORDER BY created_at, id', [doc]),
        run('SELECT * FROM tasks WHERE document_id = ? ORDER BY task_key', [doc]),
      ]);
      const state: CollaborationState = { threads: threads.rows.map(thread), notes: notes.rows.map(note), tasks: tasks.rows.map(r => ({ key: String(r.task_key), checked: !!r.checked, version: Number(r.version) })) };
      const byId = new Map(state.threads.map(thread => [thread.id, thread]));
      for (const r of comments.rows) byId.get(String(r.thread_id))?.comments.push(comment(r));
      return json(state);
    }
    const key = request.headers.get('Idempotency-Key');
    if (key !== null) requests.key(key);
    // Admission and insertion run in one SQLite statement across all adapters.
    const admission = (table: 'threads' | 'comments' | 'notes' | 'tasks') => `(SELECT COUNT(*) FROM ${table} WHERE document_id = ?) < ${COLLABORATION_LIMITS[table]} AND (? IS NULL OR (SELECT COUNT(*) FROM creation_requests WHERE document_id = ?) < ${COLLABORATION_LIMITS.creationRequests})`;
    const admissionArgs = [doc, key, doc];
    const absentCreation = async (operation: string) => key !== null && (await run('SELECT 1 FROM creation_requests WHERE document_id = ? AND operation = ? AND request_key = ?', [doc, operation, key])).rows.length ? error('deleted', 410) : error('capacity_exceeded', 409);
    const matchesRequest = async (operation: string, requestPayload: string) => {
      if (key === null) return true;
      const stored = (await run('SELECT payload FROM creation_requests WHERE document_id = ? AND operation = ? AND request_key = ?', [doc, operation, key])).rows[0]?.payload;
      return typeof stored === 'string' && JSON.stringify(JSON.parse(stored)) === requestPayload;
    };
    if (parts[0] === 'threads' && parts.length === 1 && request.method === 'POST') {
      const body = requests.body(payload.body);
      const anchor = requests.anchor(payload.anchor, doc);
      const rowId = id();
      const storedAnchor = anchor === null ? null : serializeAnchor(anchor);
      const requestPayload = JSON.stringify([body, storedAnchor]);
      await run(`INSERT INTO threads (id, document_id, body, anchor, created_at, request_key) SELECT ?, ?, ?, ?, ?, ? WHERE ${admission('threads')} AND NOT EXISTS (SELECT 1 FROM creation_requests WHERE document_id = ? AND operation = ? AND request_key = ?) ON CONFLICT(document_id, request_key) DO NOTHING`, [rowId, doc, body, storedAnchor, now(), key, ...admissionArgs, doc, 'thread', key]);
      const result = await run(key === null ? 'SELECT * FROM threads WHERE document_id = ? AND id = ?' : 'SELECT * FROM threads WHERE document_id = ? AND request_key = ?', [doc, key ?? rowId]);
      if (!result.rows.length) return absentCreation('thread');
      if (!(await matchesRequest('thread', requestPayload))) return error('idempotency_conflict', 409);
      const saved = thread(result.rows[0]!);
      if (saved.id !== rowId) { saved.body = body; saved.anchor = anchor; saved.resolved = false; }
      return json(saved, 201);
    }
    if (parts[0] === 'threads' && parts[1]) {
      const threadId = parts[1];
      if (request.method === 'DELETE' && (parts.length === 2 || (parts.length === 4 && parts[2] === 'comments'))) {
        // Keep creation keys as tombstones so an uncertain POST retry cannot recreate
        // deleted content. Remove its saved payload as part of the same transaction.
        const replyId = parts.length === 4 ? parts[3]! : null;
        const replyScope = replyId === null ? '' : ' AND id = ?';
        const replyArgs = replyId === null ? [doc, threadId] : [doc, threadId, replyId];
        const statements = [
          { sql: `UPDATE creation_requests SET payload = 'null' WHERE document_id = ? AND operation = 'comment' AND request_key IN (SELECT request_key FROM comments WHERE document_id = ? AND thread_id = ?${replyScope})`, args: [doc, ...replyArgs] },
          { sql: `DELETE FROM comments WHERE document_id = ? AND thread_id = ?${replyScope}`, args: replyArgs },
        ];
        if (replyId === null) statements.push(
          { sql: `UPDATE creation_requests SET payload = 'null' WHERE document_id = ? AND operation = 'thread' AND request_key IN (SELECT request_key FROM threads WHERE document_id = ? AND id = ?)`, args: [doc, doc, threadId] },
          { sql: 'DELETE FROM threads WHERE document_id = ? AND id = ?', args: [doc, threadId] },
        );
        await db.batch(statements);
        return json({ deleted: true });
      }
      if (!(await run('SELECT id FROM threads WHERE document_id = ? AND id = ?', [doc, threadId])).rows.length) return error('not_found', 404);
      if (parts.length === 2 && request.method === 'PATCH') {
        if (payload.resolved === undefined && payload.anchor === undefined) return error('invalid_request', 400);
        if (payload.resolved !== undefined && typeof payload.resolved !== 'boolean') return error('invalid_request', 400);
        const anchor = payload.anchor === undefined ? undefined : requests.anchor(payload.anchor, doc);
        if (payload.resolved !== undefined) await run('UPDATE threads SET resolved = ? WHERE document_id = ? AND id = ?', [Number(payload.resolved), doc, threadId]);
        if (anchor !== undefined) await run('UPDATE threads SET anchor = ? WHERE document_id = ? AND id = ?', [anchor === null ? null : serializeAnchor(anchor), doc, threadId]);
        const [updated, replies] = await Promise.all([
          run('SELECT * FROM threads WHERE document_id = ? AND id = ?', [doc, threadId]),
          run('SELECT * FROM comments WHERE document_id = ? AND thread_id = ? ORDER BY created_at, id', [doc, threadId]),
        ]);
        if (!updated.rows.length) return error('not_found', 404);
        return json({ ...thread(updated.rows[0]!), comments: replies.rows.map(comment) });
      }
      if (parts.length === 3 && parts[2] === 'comments' && request.method === 'POST') {
        const body = requests.body(payload.body);
        const rowId = id();
        const requestPayload = JSON.stringify([threadId, body]);
        await run(`INSERT INTO comments (id, document_id, thread_id, body, created_at, request_key) SELECT ?, ?, ?, ?, ?, ? WHERE ${admission('comments')} AND EXISTS (SELECT 1 FROM threads WHERE document_id = ? AND id = ?) AND NOT EXISTS (SELECT 1 FROM creation_requests WHERE document_id = ? AND operation = ? AND request_key = ?) ON CONFLICT(document_id, request_key) DO NOTHING`, [rowId, doc, threadId, body, now(), key, ...admissionArgs, doc, threadId, doc, 'comment', key]);
        const r = (await run(key === null ? 'SELECT * FROM comments WHERE document_id = ? AND id = ?' : 'SELECT * FROM comments WHERE document_id = ? AND request_key = ?', [doc, key ?? rowId])).rows[0];
        if (!r) return absentCreation('comment');
        if (!(await matchesRequest('comment', requestPayload))) return error('idempotency_conflict', 409);
        return json(comment(r), 201);
      }
    }
    if (parts[0] === 'notes' && parts.length === 1 && request.method === 'POST') {
      const body = requests.body(payload.body);
      const rowId = id(), time = now();
      const requestPayload = JSON.stringify([body]);
      await run(`INSERT INTO notes (id, document_id, body, created_at, updated_at, request_key) SELECT ?, ?, ?, ?, ?, ? WHERE ${admission('notes')} AND NOT EXISTS (SELECT 1 FROM creation_requests WHERE document_id = ? AND operation = 'note' AND request_key = ?) ON CONFLICT(document_id, request_key) DO NOTHING`, [rowId, doc, body, time, time, key, ...admissionArgs, doc, key]);
      const row = (await run(key === null ? 'SELECT * FROM notes WHERE document_id = ? AND id = ?' : 'SELECT * FROM notes WHERE document_id = ? AND request_key = ?', [doc, key ?? rowId])).rows[0]!;
      if (!row) return absentCreation('note');
      if (!(await matchesRequest('note', requestPayload))) return error('idempotency_conflict', 409);
      const saved = note(row);
      if (saved.id !== rowId) { saved.body = body; saved.version = 1; saved.updatedAt = saved.createdAt; }
      return json(saved, 201);
    }
    if (parts[0] === 'notes' && parts.length === 2 && request.method === 'PATCH') {
      const { body, version } = requests.notePatch(payload);
      const result = await run('UPDATE notes SET body = ?, version = version + 1, updated_at = ? WHERE document_id = ? AND id = ? AND version = ? AND body <> ? RETURNING *', [body, now(), doc, parts[1]!, version, body]);
      if (result.rows.length) return json(note(result.rows[0]!));
      const current = (await run('SELECT * FROM notes WHERE document_id = ? AND id = ?', [doc, parts[1]!])).rows[0];
      if (!current) return error('not_found', 404);
      if (Number(current.version) === version && current.body === body) return json(note(current));
      return json({ error: 'conflict', current: note(current) }, 409);
    }
    if (parts[0] === 'tasks' && parts.length === 2 && request.method === 'PUT') {
      const taskKey = requests.taskKey(parts[1]);
      const taskPayload = requests.taskPut(payload);
      const result = await run(`INSERT INTO tasks (document_id, task_key, checked, version) SELECT ?, ?, ?, 1 WHERE ((SELECT COUNT(*) FROM tasks WHERE document_id = ?) < ${COLLABORATION_LIMITS.tasks} OR EXISTS (SELECT 1 FROM tasks WHERE document_id = ? AND task_key = ?)) AND (? IS NULL OR ? = 0 OR EXISTS (SELECT 1 FROM tasks WHERE document_id = ? AND task_key = ?)) ON CONFLICT(document_id, task_key) DO UPDATE SET checked = excluded.checked, version = CASE WHEN tasks.checked = excluded.checked THEN tasks.version ELSE tasks.version + 1 END WHERE ? IS NULL OR tasks.version = ? OR tasks.checked = excluded.checked`, [doc, taskKey, Number(taskPayload.checked), doc, doc, taskKey, taskPayload.version === undefined ? null : Number(taskPayload.version), taskPayload.version === undefined ? null : Number(taskPayload.version), doc, taskKey, taskPayload.version === undefined ? null : Number(taskPayload.version), taskPayload.version === undefined ? null : Number(taskPayload.version)]);
      const current = (await run('SELECT * FROM tasks WHERE document_id = ? AND task_key = ?', [doc, taskKey])).rows[0];
      if (!current) return error(taskPayload.version !== undefined && taskPayload.version > 0 ? 'conflict' : 'capacity_exceeded', 409);
      const task = { key: taskKey, checked: !!current.checked, version: Number(current.version) };
      if (!result.changes) return json({ error: 'conflict', current: task }, 409);
      return json(task);
    }
    return error('not_found', 404);
  };
  return async request => {
    try { return await handle(request); }
    catch (cause) {
      if (cause instanceof InvalidResponse) return error('invalid_request', 400);
      throw cause;
    }
  };
}
function serializeAnchor(anchor: TextAnchor): string {
  return JSON.stringify({ quote: anchor.quote, prefix: anchor.prefix, suffix: anchor.suffix, start: anchor.start, end: anchor.end, ...(anchor.revision === undefined ? {} : { revision: anchor.revision }), ...(anchor.documentId === undefined ? {} : { documentId: anchor.documentId }) });
}
