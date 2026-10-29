export interface CollaborationConfig {
  documentId: string;
  revision: string;
  apiUrl: string;
  contentSelector?: string;
}

export interface TextAnchor {
  quote: string;
  prefix: string;
  suffix: string;
  start: number;
  end: number;
  revision?: string;
  documentId?: string;
}

export interface Comment { id: string; body: string; createdAt: string }
export interface Thread { id: string; body: string; anchor: TextAnchor | null; resolved: boolean; createdAt: string; comments: Comment[] }
export interface Note { id: string; body: string; version: number; createdAt: string; updatedAt: string }
export interface Task { key: string; checked: boolean; version: number }
export interface CollaborationState { threads: Thread[]; notes: Note[]; tasks: Task[] }
export interface NoteConflict { error: 'conflict'; current: Note }

export const COLLABORATION_PROVIDERS = ['local', 'cloudflare', 'vercel'] as const;
export type CollaborationProvider = typeof COLLABORATION_PROVIDERS[number];
export const TASK_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/;
export const COLLABORATION_LIMITS = { bodyCharacters: 4096, threads: 128, comments: 512, notes: 64, tasks: 512, creationRequests: 2048, noteHistory: 20 } as const;

export class InvalidResponse extends Error {}

type Parser<T> = (value: unknown, path: string) => T;

const fail = (path: string, expected: string): never => {
  throw new InvalidResponse(`${path} is not ${expected}`);
};
const string: Parser<string> = (value, path) => (typeof value === 'string' ? value : fail(path, 'a string'));
const integer: Parser<number> = (value, path) => (typeof value === 'number' && Number.isSafeInteger(value) ? value : fail(path, 'an integer'));
const boolean: Parser<boolean> = (value, path) => (typeof value === 'boolean' ? value : fail(path, 'a boolean'));
const optional = <T>(parse: Parser<T>): Parser<T | undefined> => (value, path) => (value === undefined ? undefined : parse(value, path));
const nullable = <T>(parse: Parser<T>): Parser<T | null> => (value, path) => (value === null ? null : parse(value, path));
const array = <T>(parse: Parser<T>): Parser<T[]> => (value, path) =>
  Array.isArray(value) ? value.map((item, i) => parse(item, `${path}[${i}]`)) : fail(path, 'an array');
const object = <S extends Record<string, Parser<unknown>>>(shape: S): Parser<{ [K in keyof S]: ReturnType<S[K]> }> => (value, path) => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return fail(path, 'an object');
  const record = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(shape)) result[key] = shape[key]!(record[key], `${path}.${key}`);
  // Every key of the shape was assigned from its own parser above.
  return result as { [K in keyof S]: ReturnType<S[K]> };
};

const bounded = (limit: number, nonblank = false): Parser<string> => (value, path) => {
  const text = string(value, path);
  return text.length <= limit && (!nonblank || text.trim().length > 0) ? text : fail(path, 'valid bounded text');
};
const version = (minimum: number): Parser<number> => (value, path) => {
  const result = integer(value, path);
  return result >= minimum ? result : fail(path, 'a valid version');
};
const anchor: Parser<TextAnchor> = (value, path) => {
  const parsed = object({ quote: bounded(4096, true), prefix: bounded(1000), suffix: bounded(1000), start: version(0), end: version(1), revision: optional(bounded(1000)), documentId: optional(bounded(1000)) })(value, path);
  if (Object.keys(Object(value)).some(key => !['quote', 'prefix', 'suffix', 'start', 'end', 'revision', 'documentId'].includes(key)) || parsed.end <= parsed.start) fail(path, 'a valid anchor');
  return parsed;
};
const comment: Parser<Comment> = object({ id: string, body: string, createdAt: string });
const thread: Parser<Thread> = object({
  id: string, body: string, anchor: nullable(anchor), resolved: boolean, createdAt: string, comments: array(comment),
});
const note: Parser<Note> = object({ id: string, body: string, version: integer, createdAt: string, updatedAt: string });
const task: Parser<Task> = object({ key: string, checked: boolean, version: integer });
const state: Parser<CollaborationState> = object({ threads: array(thread), notes: array(note), tasks: array(task) });
const errorBody = object({ error: string });

export const parse = {
  deletion: (value: unknown): void => {
    if (!object({ deleted: boolean })(value, 'deletion').deleted) fail('deletion.deleted', 'true');
  },
  state: (value: unknown) => state(value, 'state'),
  thread: (value: unknown) => thread(value, 'thread'),
  comment: (value: unknown) => comment(value, 'comment'),
  note: (value: unknown) => note(value, 'note'),
  task: (value: unknown) => task(value, 'task'),
  errorCode: (value: unknown) => errorBody(value, 'error').error,
};

// Request and response parsing share the same primitives; errors never include input values.
const body = bounded(COLLABORATION_LIMITS.bodyCharacters, true);
export const requests = {
  body: (value: unknown) => body(value, 'body'),
  revision: (value: unknown) => bounded(1000, true)(value, 'revision'),
  key: (value: unknown) => bounded(200, true)(value, 'key'),
  anchor: (value: unknown, documentId: string) => {
    const result = nullable(anchor)(value, 'anchor');
    if (result?.documentId !== undefined && result.documentId !== documentId) fail('anchor', 'scoped to this document');
    return result;
  },
  notePatch: (value: unknown) => object({ body, version: version(1) })(value, 'note'),
  taskPut: (value: unknown) => object({ checked: boolean, version: optional(version(0)) })(value, 'task'),
  taskKey: (value: unknown) => {
    const key = string(value, 'task.key');
    return TASK_KEY.test(key) ? key : fail('task.key', 'a valid task key');
  },
};
