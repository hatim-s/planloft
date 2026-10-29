import type { CollaborationState, Comment, Note, Task, TextAnchor, Thread } from '../contracts.js';

// Response parsers for the collaboration API. They are the only place the client checks
// shapes; each is annotated with its contract type so a contract change breaks the build.

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

const anchor: Parser<TextAnchor> = object({
  quote: string, prefix: string, suffix: string, start: integer, end: integer,
  revision: optional(string), documentId: optional(string),
});
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
