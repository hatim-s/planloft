export type SqlValue = string | number | null;
export interface Statement { sql: string; args?: SqlValue[] }
export interface SqlResult { rows: Record<string, unknown>[]; changes: number }
export interface Database { execute(statement: Statement): Promise<SqlResult>; batch(statements: Statement[]): Promise<SqlResult[]> }

export const schema = [
  `CREATE TABLE IF NOT EXISTS documents (id TEXT PRIMARY KEY, revision TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS threads (id TEXT PRIMARY KEY, document_id TEXT NOT NULL REFERENCES documents(id), body TEXT NOT NULL, anchor TEXT, resolved INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, request_key TEXT, UNIQUE(document_id, request_key))`,
  `CREATE TABLE IF NOT EXISTS comments (id TEXT PRIMARY KEY, document_id TEXT NOT NULL REFERENCES documents(id), thread_id TEXT NOT NULL REFERENCES threads(id), body TEXT NOT NULL, created_at TEXT NOT NULL, request_key TEXT, UNIQUE(document_id, request_key))`,
  `CREATE TABLE IF NOT EXISTS notes (id TEXT PRIMARY KEY, document_id TEXT NOT NULL REFERENCES documents(id), body TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, request_key TEXT, UNIQUE(document_id, request_key))`,
  `CREATE TABLE IF NOT EXISTS creation_requests (document_id TEXT NOT NULL, operation TEXT NOT NULL, request_key TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(document_id, operation, request_key))`,
  `CREATE TRIGGER IF NOT EXISTS threads_request_insert AFTER INSERT ON threads WHEN NEW.request_key IS NOT NULL BEGIN INSERT INTO creation_requests VALUES (NEW.document_id, 'thread', NEW.request_key, json_array(NEW.body, NEW.anchor)); END`,
  `CREATE TRIGGER IF NOT EXISTS comments_request_insert AFTER INSERT ON comments WHEN NEW.request_key IS NOT NULL BEGIN INSERT INTO creation_requests VALUES (NEW.document_id, 'comment', NEW.request_key, json_array(NEW.thread_id, NEW.body)); END`,
  `CREATE TRIGGER IF NOT EXISTS notes_request_insert AFTER INSERT ON notes WHEN NEW.request_key IS NOT NULL BEGIN INSERT INTO creation_requests VALUES (NEW.document_id, 'note', NEW.request_key, json_array(NEW.body)); END`,
  `CREATE TABLE IF NOT EXISTS note_history (note_id TEXT NOT NULL, document_id TEXT NOT NULL, body TEXT NOT NULL, version INTEGER NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(note_id, version))`,
  `CREATE TRIGGER IF NOT EXISTS notes_history_insert AFTER INSERT ON notes BEGIN INSERT INTO note_history VALUES (NEW.id, NEW.document_id, NEW.body, NEW.version, NEW.updated_at); END`,
  `CREATE TRIGGER IF NOT EXISTS notes_history_update AFTER UPDATE OF body, version ON notes BEGIN INSERT INTO note_history VALUES (NEW.id, NEW.document_id, NEW.body, NEW.version, NEW.updated_at); END`,
  `CREATE TABLE IF NOT EXISTS tasks (document_id TEXT NOT NULL REFERENCES documents(id), task_key TEXT NOT NULL, checked INTEGER NOT NULL, version INTEGER NOT NULL, PRIMARY KEY(document_id, task_key))`,
];
export async function migrate(db: Database): Promise<void> { await db.batch(schema.map(sql => ({ sql }))); }

interface D1Statement { bind(...args: SqlValue[]): D1Statement; all(): Promise<{ results?: Record<string, unknown>[]; meta?: { changes?: number } }> }
interface D1Binding { prepare(sql: string): D1Statement; batch(statements: D1Statement[]): Promise<{ results?: Record<string, unknown>[]; meta?: { changes?: number } }[]> }
export function d1Database(binding: D1Binding): Database {
  const prepared = (s: Statement) => binding.prepare(s.sql).bind(...(s.args ?? []));
  const map = (r: { results?: Record<string, unknown>[]; meta?: { changes?: number } }): SqlResult => ({ rows: r.results ?? [], changes: r.meta?.changes ?? 0 });
  return { execute: async s => map(await prepared(s).all()), batch: async ss => (await binding.batch(ss.map(prepared))).map(map) };
}
interface LibsqlResult { rows: readonly unknown[]; rowsAffected: number }
interface LibsqlClient { execute(s: { sql: string; args: SqlValue[] }): Promise<LibsqlResult>; batch(s: { sql: string; args: SqlValue[] }[], mode: 'write'): Promise<LibsqlResult[]> }
export function tursoDatabase(client: LibsqlClient): Database {
  const statement = (s: Statement) => ({ sql: s.sql, args: s.args ?? [] });
  const map = (r: LibsqlResult): SqlResult => ({ rows: r.rows.map(row => Object.fromEntries(Object.entries(row as Record<string, unknown>))), changes: r.rowsAffected });
  return { execute: async s => map(await client.execute(statement(s))), batch: async ss => (await client.batch(ss.map(statement), 'write')).map(map) };
}
