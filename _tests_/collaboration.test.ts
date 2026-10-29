import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { captureAnchor, resolveAnchor } from '../src/collaboration/anchors.js';
import { migrate, type Database, type Statement } from '../src/collaboration/database.js';
import { createCollaborationService } from '../src/collaboration/service.js';

test('anchors use code points and find exact, changed and missing quotes', () => {
  const original = '😀 Before a useful passage here after';
  const anchor = captureAnchor(original, 9, 30, { documentId: 'one', revision: '1' });
  assert.equal(anchor.quote, 'a useful passage here');
  assert.deepEqual(resolveAnchor('New 😀 Before a useful passage here after', anchor), { status: 'exact', start: 13, end: 34 });
  const fuzzy = resolveAnchor('😀 Before a useful passages here after', anchor);
  assert.equal(fuzzy.status, 'approximate');
  assert.deepEqual(resolveAnchor('nothing related', anchor), { status: 'unattached' });
});

test('SQLite service scopes records, saves note history and handles retries', async () => {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');
  const execute = (s: Statement) => {
    const prepared = sqlite.prepare(s.sql);
    if (/^\s*SELECT/i.test(s.sql) || /\bRETURNING\b/i.test(s.sql)) return { rows: prepared.all(...(s.args ?? [])), changes: 0 };
    return { rows: [], changes: Number(prepared.run(...(s.args ?? [])).changes) };
  };
  const db: Database = { execute: async s => execute(s), batch: async ss => { sqlite.exec('BEGIN'); try { const result = ss.map(execute); sqlite.exec('COMMIT'); return result; } catch (e) { sqlite.exec('ROLLBACK'); throw e; } } };
  await migrate(db);
  const service = createCollaborationService(db, 'secret');
  const call = async (path: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) => {
    const response = await service(new Request(`http://local/documents/${path}`, { method, headers: { 'Content-Type': 'application/json', ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));
    return { status: response.status, data: await response.json() as any };
  };
  const publicService = createCollaborationService(db);
  const disabled = await publicService(new Request('http://local/documents/seeded', { method: 'PUT', headers: { Authorization: 'Bearer undefined' }, body: JSON.stringify({ revision: '1' }) }));
  assert.equal(disabled.status, 503);
  assert.deepEqual(await disabled.json(), { error: 'registration_disabled' });
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM documents').get()?.count, 0);
  sqlite.prepare('INSERT INTO documents (id, revision) VALUES (?, ?)').run('seeded', '1');
  const publicThread = await publicService(new Request('http://local/documents/seeded/threads', { method: 'POST', body: JSON.stringify({ body: 'Public comment', anchor: null }) }));
  assert.equal(publicThread.status, 201);
  const publicState = await publicService(new Request('http://local/documents/seeded/state'));
  assert.equal(publicState.status, 200);
  assert.equal((await publicState.json() as { threads: { body: string }[] }).threads[0]?.body, 'Public comment');
  assert.equal((await call('a', 'PUT', {revision:'1'})).status, 401);
  for (const doc of ['a','b']) assert.equal((await call(doc, 'PUT', {revision:'1'}, { Authorization:'Bearer secret' })).status, 200);
  const first = await call('a/threads', 'POST', { body:'hello', anchor:null }, { 'Idempotency-Key':'thread-1' });
  const retry = await call('a/threads', 'POST', { body:'hello', anchor:null }, { 'Idempotency-Key':'thread-1' });
  assert.equal(first.data.id, retry.data.id);
  assert.equal((await call('a/threads', 'POST', { body:'different', anchor:null }, { 'Idempotency-Key':'thread-1' })).status, 409);
  assert.equal((await call(`b/threads/${first.data.id}/comments`, 'POST', { body:'cross document' })).status, 404);
  const comment = await call(`a/threads/${first.data.id}/comments`, 'POST', { body:'reply' }, { 'Idempotency-Key':'comment-1' });
  assert.equal((await call(`a/threads/${first.data.id}/comments`, 'POST', { body:'reply' }, { 'Idempotency-Key':'comment-1' })).data.id, comment.data.id);
  assert.equal((await call(`a/threads/${first.data.id}/comments`, 'POST', { body:'different' }, { 'Idempotency-Key':'comment-1' })).status, 409);
  sqlite.prepare('INSERT INTO comments (id, document_id, thread_id, body, created_at) VALUES (?, ?, ?, ?, ?)').run('cross-doc', 'b', first.data.id, 'not visible', '2000');
  const resolved = await call(`a/threads/${first.data.id}`, 'PATCH', {resolved:true});
  assert.equal(resolved.data.resolved, true);
  assert.deepEqual(resolved.data.comments, [comment.data]);
  const anchor = {quote:'hello', prefix:'', suffix:'', start:0, end:5};
  const reattached = await call(`a/threads/${first.data.id}`, 'PATCH', {anchor});
  assert.deepEqual(reattached.data.anchor, anchor);
  assert.deepEqual(reattached.data.comments, [comment.data]);
  assert.deepEqual((await call('a/state')).data.threads[0].comments, [comment.data]);

  const created = await call('a/notes', 'POST', {body:'original'}, {'Idempotency-Key':'note-1'});
  const updated = await call(`a/notes/${created.data.id}`, 'PATCH', {body:'new', version:1});
  assert.equal(updated.data.version, 2);
  assert.equal((await call('a/notes', 'POST', {body:'different'}, {'Idempotency-Key':'note-1'})).status, 409);
  const noteRetry = await call('a/notes', 'POST', {body:'original'}, {'Idempotency-Key':'note-1'});
  assert.equal(noteRetry.status, 201);
  assert.equal(noteRetry.data.body, 'original');
  assert.equal(noteRetry.data.version, 1);
  const invalidAnchor = {quote:'yes', prefix:'x'.repeat(1001), suffix:'', start:0, end:3};
  assert.equal((await call('a/threads', 'POST', {body:'hi', anchor:invalidAnchor})).status, 400);
  assert.equal((await call('a/threads', 'POST', {body:'hi', anchor:{...invalidAnchor, prefix:'', extra:'x'}})).status, 400);
  const conflict = await call(`a/notes/${created.data.id}`, 'PATCH', {body:'draft', version:1});
  assert.equal(conflict.status, 409); assert.equal(conflict.data.current.body, 'new');
  assert.deepEqual(sqlite.prepare('SELECT body, version FROM note_history ORDER BY version').all().map(r => ({...r})), [{body:'original',version:1},{body:'new',version:2}]);
  assert.equal((await call(`b/notes/${created.data.id}`, 'PATCH', {body:'x',version:2})).status, 404);
  assert.equal((await call('a/tasks/todo', 'PUT', {checked:true, version:0})).data.version, 1);
  assert.equal((await call('a/tasks/todo', 'PUT', {checked:true, version:0})).data.version, 1);
  assert.equal((await call('a/tasks/todo', 'PUT', {checked:false, version:1})).data.version, 2);
  assert.equal((await call('a/tasks/todo', 'PUT', {checked:true, version:1})).status, 409);
  sqlite.close();
});

test('Turso adapter executes migrations and writes against a local libSQL database', async () => {
  const { createClient } = await import('@libsql/client');
  const { tursoDatabase } = await import('../src/collaboration/database.js');
  const client = createClient({ url: 'file::memory:' });
  const db = tursoDatabase(client);
  await migrate(db);
  const service = createCollaborationService(db, 'secret');
  const register = await service(new Request('http://local/documents/libsql', { method:'PUT', headers:{ Authorization:'Bearer secret', 'Content-Type':'application/json' }, body:JSON.stringify({revision:'one'}) }));
  assert.equal(register.status, 200);
  const created = await service(new Request('http://local/documents/libsql/notes', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({body:'stored'}) }));
  assert.equal(created.status, 201);
  const createdNote = await created.json() as {id:string};
  const updated = await service(new Request(`http://local/documents/libsql/notes/${createdNote.id}`, { method:'PATCH', body:JSON.stringify({body:'updated',version:1}) }));
  assert.equal((await updated.json() as {body:string;version:number}).version, 2);
  const state = await service(new Request('http://local/documents/libsql/state'));
  assert.equal((await state.json() as any).notes[0].body, 'updated');
  client.close();
});

test('attachment bundles imported helpers and keeps identity and HTML stable', async () => {
  const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { attachCollaboration } = await import('../src/collaboration/attachment.js');
  const dir = await mkdtemp(join(tmpdir(), 'planloft-attach-'));
  try {
    await writeFile(join(dir, 'helper.ts'), 'export const value = "ok"');
    await writeFile(join(dir, 'client.ts'), 'import { value } from "./helper"; export function mountCollaboration(config) { document.body.dataset.test = value; document.body.dataset.documentId = config.documentId }');
    await writeFile(join(dir, 'client.css'), 'body { color: red }');
    const options = {clientPath:join(dir,'client.ts'), cssPath:join(dir,'client.css')};
    const source = '<html><body><script>window.keep = \"</body>\"</script><!-- </body> -->content</body></html>';
    const first = await attachCollaboration(source, {documentId:'original',revision:'1',apiUrl:'https://api.example/$&/$\'/$`'}, options);
    const second = await attachCollaboration(first.html, {documentId:'different',revision:'1',apiUrl:'https://api.example/$&/$\'/$`'}, options);
    assert.equal(second.config.documentId, 'original');
    assert.equal(second.html, first.html);
    const blockStart = second.html.indexOf('<!-- planloft-collaboration:start -->');
    const blockEnd = second.html.indexOf('<!-- planloft-collaboration:end -->') + '<!-- planloft-collaboration:end -->'.length;
    assert.equal(second.html.slice(0, blockStart) + second.html.slice(blockEnd + 1), source);
    const unrelated = '<script type="application/json" id="planloft-collaboration-config">{"documentId":"unrelated"}</script>';
    const withUnrelated = source.replace('<body>', `<body>${unrelated}`);
    const attached = await attachCollaboration(withUnrelated, {documentId:'owned',revision:'1',apiUrl:'https://api.example'}, options);
    assert.equal(attached.config.documentId, 'owned');
    const reattached = await attachCollaboration(attached.html, {documentId:'new',revision:'2',apiUrl:'https://api.example'}, options);
    assert.equal(reattached.config.documentId, 'owned');
    const { runInNewContext } = await import('node:vm');
    const runtime = reattached.html.match(/<script data-planloft-collaboration>([\s\S]*?)<\/script>/)![1]!;
    const dataset: Record<string, string> = {};
    const document = { body: {dataset}, currentScript: {previousElementSibling: {textContent: JSON.stringify(reattached.config)}}, getElementById: () => ({textContent: '{"documentId":"unrelated"}'}) };
    runInNewContext(runtime, {document});
    assert.equal(dataset.documentId, 'owned');
    assert.equal(dataset.test, 'ok');
    assert.ok(reattached.html.includes(unrelated));
    const start = '<!-- planloft-collaboration:start -->';
    const end = '<!-- planloft-collaboration:end -->';
    const badInputs = [
      `<html><body>${start}<p>KEEP THIS</p>${end}</body></html>`,
      `<html><body>${start}</body></html>`,
      `<html><body>${end}</body></html>`,
      `<html><body>${end}${start}</body></html>`,
      '<html><body><!-- planloft-collaboration:start extra --></body></html>',
      `<html><body><!-- planloft-collaboration:start --!>${end}</body></html>`,
      `<html><body>${start}${start}${end}${end}</body></html>`,
      attached.html.replace(start, `${start}<p>KEEP THIS</p>`),
      attached.html.replace(start, `${start}<!-- unrelated -->`),
      attached.html.replace(start, `${start}${start}`),
      attached.html + end,
      attached.html.replace('"documentId":"owned"', '"documentId":123'),
      `<html><body><template>${start}</template></body></html>`,
    ];
    for (const html of badInputs) {
      await assert.rejects(attachCollaboration(html, {documentId:'new',revision:'1',apiUrl:'https://api.example'}, options), /Invalid collaboration (markers|block|configuration)/);
    }
    const markerInScript = `<html><body><script>const example = "${start}"</script></body></html>`;
    assert.ok((await attachCollaboration(markerInScript, {documentId:'script',revision:'1',apiUrl:'https://api.example'}, options)).html.includes(markerInScript.slice(0, markerInScript.lastIndexOf('</body>'))));

  } finally { await rm(dir, {recursive:true, force:true}); }
});

test('D1 adapter executes statements and batches against SQLite', async () => {
  const { d1Database } = await import('../src/collaboration/database.js');
  const sqlite = new DatabaseSync(':memory:');
  class Prepared {
    args: (string | number | null)[] = [];
    constructor(readonly sql: string) {}
    bind(...args: (string | number | null)[]) { this.args = args; return this; }
    async all() {
      const stmt = sqlite.prepare(this.sql);
      if (/^\s*SELECT/i.test(this.sql) || /\bRETURNING\b/i.test(this.sql)) return { results: stmt.all(...this.args), meta: {changes: 0} };
      return { results: [], meta: {changes: Number(stmt.run(...this.args).changes)} };
    }
  }
  const binding = { prepare: (sql: string) => new Prepared(sql), batch: async (statements: Prepared[]) => { sqlite.exec('BEGIN'); try { const result = []; for (const statement of statements) result.push(await statement.all()); sqlite.exec('COMMIT'); return result; } catch (e) { sqlite.exec('ROLLBACK'); throw e; } } };
  const db = d1Database(binding); await migrate(db);
  await db.execute({sql:'INSERT INTO documents (id, revision) VALUES (?, ?)', args:['doc','1']});
  assert.equal((await db.execute({sql:'SELECT revision FROM documents WHERE id = ?', args:['doc']})).rows[0]?.revision, '1');
  sqlite.close();
});

test('anchors compare changed context with duplicate exact quotes and handle short and long edits', () => {
  const original = 'Context A The project plan is approved end A';
  const anchor = captureAnchor(original, 10, 38);
  const changed = 'Context A The project plan was approved end A Context B The project plan is approved end B';
  const match = resolveAnchor(changed, anchor);
  assert.deepEqual(match, { status: 'approximate', start: 10, end: 39 });
  for (const [before, quote, after, replacement] of [
    ['Before yes after', 'yes', 'Before yet after', 'yet'],
    ['前面你好后面', '你好', '前面你们后面', '你们'],
    [`Before ${'A long sentence about the plan. '.repeat(8)} after`, 'A long sentence about the plan. '.repeat(8), `Before ${'A long sentence about the plan. '.repeat(4)}A revised sentence about the plan. ${'A long sentence about the plan. '.repeat(3)} after`, null],
  ] as const) {
    const start = Array.from(before.slice(0, before.indexOf(quote))).length;
    const result = resolveAnchor(after, captureAnchor(before, start, start + Array.from(quote).length));
    assert.equal(result.status, 'approximate');
    if (replacement) assert.equal(Array.from(after).slice(result.start, result.end).join(''), replacement);
  }
  assert.deepEqual(resolveAnchor('unrelated material', anchor), { status: 'unattached' });
});

test('request streaming limits and malformed paths return controlled errors', async () => {
  const db: Database = { execute: async () => ({ rows: [], changes: 0 }), batch: async () => [] };
  const service = createCollaborationService(db, 'secret');
  assert.equal((await service(new Request('http://local/documents/%FF/state'))).status, 400);
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(260_000)); controller.close(); } });
  const response = await service(new Request('http://local/documents/a/notes', {method:'POST', body:stream, duplex:'half'} as RequestInit));
  assert.equal(response.status, 413);
  assert.deepEqual(await response.json(), {error:'body_too_large'});
});

test('note update returns its own revision when another writer commits before the response', async () => {
  const sqlite = new DatabaseSync(':memory:');
  const execute = (s: Statement) => {
    const statement = sqlite.prepare(s.sql);
    if (/^\s*SELECT/i.test(s.sql) || /\bRETURNING\b/i.test(s.sql)) return { rows: statement.all(...(s.args ?? [])), changes: 0 };
    return { rows: [], changes: Number(statement.run(...(s.args ?? [])).changes) };
  };
  let interleave = false;
  const db: Database = {
    execute: async s => {
      const result = execute(s);
      if (interleave && /UPDATE notes .*RETURNING/.test(s.sql)) {
        interleave = false;
        execute({sql:'UPDATE notes SET body = ?, version = version + 1, updated_at = ? WHERE id = ?', args:['writer B', 'later', s.args![3]!]});
      }
      return result;
    },
    batch: async statements => statements.map(execute),
  };
  await migrate(db);
  const service = createCollaborationService(db, 'secret');
  const send = (path: string, method: string, body: unknown) => service(new Request(`http://local/documents/doc${path}`, {method, headers:{Authorization:'Bearer secret'}, body:JSON.stringify(body)}));
  await send('', 'PUT', {revision:'1'});
  const created = await (await send('/notes', 'POST', {body:'first'})).json() as {id:string};
  interleave = true;
  const response = await send(`/notes/${created.id}`, 'PATCH', {body:'writer A',version:1});
  const saved = await response.json() as {body:string; version:number};
  assert.equal(response.status, 200);
  assert.equal(saved.body, 'writer A');
  assert.equal(saved.version, 2);
  assert.deepEqual(sqlite.prepare('SELECT body, version FROM note_history ORDER BY version').all().map(row => ({...row})), [
    {body:'first',version:1}, {body:'writer A',version:2}, {body:'writer B',version:3},
  ]);
  sqlite.close();
});
