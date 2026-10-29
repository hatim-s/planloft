import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@libsql/client';
import { migrate, tursoDatabase } from '../src/collaboration/database.js';
import { createCollaborationService } from '../src/collaboration/service.js';
import { parse } from '../src/collaboration/ui/parse.js';

test('deletion is scoped, atomic, repeatable and cannot resurrect content through creation retries', async () => {
  const client = createClient({ url: 'file::memory:' });
  const db = tursoDatabase(client);
  try {
    await migrate(db);
    const service = createCollaborationService(db, 'test');
    const call = (path: string, method = 'GET', body?: unknown, key?: string) => service(new Request(`http://local/documents/${path}`, {
      method, headers: { Authorization: 'Bearer test', ...(key ? { 'Idempotency-Key': key } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }));
    for (const doc of ['a', 'b']) assert.equal((await call(doc, 'PUT', { revision: '1' })).status, 200);
    const body = { body: 'Delete this opening comment', anchor: null };
    const root = parse.thread(await (await call('a/threads', 'POST', body, 'thread')).json());
    const other = parse.thread(await (await call('a/threads', 'POST', { ...body, body: 'Keep this thread' })).json());
    const replyPath = `a/threads/${root.id}/comments`;
    const reply = parse.comment(await (await call(replyPath, 'POST', { body: 'Remove this reply' }, 'reply')).json());
    const kept = parse.comment(await (await call(replyPath, 'POST', { body: 'Keep until thread deletion' }, 'kept')).json());
    const state = async () => parse.state(await (await call('a/state')).json());
    assert.match((await call(`a/threads/${root.id}`, 'OPTIONS')).headers.get('Access-Control-Allow-Methods')!, /DELETE/);
    assert.equal((await call(`b/threads/${root.id}`, 'DELETE')).status, 200);
    assert.equal((await call(`a/threads/${other.id}/comments/${reply.id}`, 'DELETE')).status, 200);
    assert.equal((await state()).threads.find(thread => thread.id === root.id)?.comments.length, 2);
    for (let retry = 0; retry < 2; retry++) assert.equal((await call(`${replyPath}/${reply.id}`, 'DELETE')).status, 200);
    assert.deepEqual((await state()).threads.find(thread => thread.id === root.id)?.comments, [kept]);
    assert.equal((await call(replyPath, 'POST', { body: 'Remove this reply' }, 'reply')).status, 410);

    // A failed transaction must not leave an empty thread or erase retry records.
    await db.execute({ sql: `CREATE TRIGGER reject_thread_delete BEFORE DELETE ON threads BEGIN SELECT RAISE(ABORT, 'test rollback'); END` });
    await assert.rejects(call(`a/threads/${root.id}`, 'DELETE'), /test rollback/);
    assert.deepEqual((await state()).threads.find(thread => thread.id === root.id)?.comments, [kept]);
    assert.equal((await call(replyPath, 'POST', { body: 'Keep until thread deletion' }, 'kept')).status, 201);
    await db.execute({ sql: 'DROP TRIGGER reject_thread_delete' });
    for (let retry = 0; retry < 2; retry++) assert.equal((await call(`a/threads/${root.id}`, 'DELETE')).status, 200);
    assert.deepEqual((await state()).threads.map(thread => thread.id), [other.id]);
    assert.equal((await call('a/threads', 'POST', body, 'thread')).status, 410);
    assert.equal((await call(replyPath, 'POST', { body: 'Late reply' })).status, 404);
    assert.equal((await call(`a/threads/${root.id}`, 'PATCH', { resolved: true })).status, 404);
    const records = await db.execute({ sql: 'SELECT payload FROM creation_requests WHERE document_id = ?', args: ['a'] });
    assert.deepEqual(records.rows.map(row => row.payload), ['null', 'null', 'null']);
    assert.equal((await db.execute({ sql: 'SELECT * FROM comments' })).rows.length, 0);
  } finally { client.close(); }
});
