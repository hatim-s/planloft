import type { CollaborationConfig, CollaborationState, Comment, Note, Task, TextAnchor, Thread } from '../contracts.js';
import { InvalidResponse, parse } from './parse.js';

/**
 * Why a request did not produce the value. `offline` means it was never sent. `network`
 * means it was sent and no response arrived, so it may or may not have reached the server.
 */
export type Failure<T = never> =
  | { kind: 'offline' }
  | { kind: 'network' }
  | { kind: 'conflict'; current: T }
  | { kind: 'status'; status: number; code: string | null }
  | { kind: 'invalid' };

export type Result<T, C = never> = { ok: true; value: T } | { ok: false; failure: Failure<C> };

type Send = {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  path: string;
  body?: unknown;
  idempotencyKey?: string;
};

/** A random key for one logical creation. Works outside secure contexts, unlike randomUUID. */
export function idempotencyKey(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
}

export function createApi(config: CollaborationConfig) {
  const base = `${config.apiUrl.replace(/\/+$/, '')}/documents/${encodeURIComponent(config.documentId)}`;

  async function send<T, C = never>(request: Send, read: (value: unknown) => T, readConflict?: (value: unknown) => C): Promise<Result<T, C>> {
    if (!navigator.onLine) return { ok: false, failure: { kind: 'offline' } };
    const headers: Record<string, string> = {};
    if (request.body !== undefined) headers['Content-Type'] = 'application/json';
    if (request.idempotencyKey) headers['Idempotency-Key'] = request.idempotencyKey;
    let response: Response;
    try {
      response = await fetch(`${base}${request.path}`, {
        method: request.method,
        headers,
        body: request.body === undefined ? undefined : JSON.stringify(request.body),
        cache: 'no-store',
      });
    } catch {
      // Sent, even if the reader has gone offline since, so it may have been saved.
      return { ok: false, failure: { kind: 'network' } };
    }
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      if (response.ok) return { ok: false, failure: { kind: 'invalid' } };
    }
    try {
      if (response.ok) return { ok: true, value: read(body) };
      if (response.status === 409 && readConflict && typeof body === 'object' && body !== null && 'current' in body) {
        return { ok: false, failure: { kind: 'conflict', current: readConflict(body.current) } };
      }
      let code: string | null = null;
      try { code = parse.errorCode(body); } catch {}
      return { ok: false, failure: { kind: 'status', status: response.status, code } };
    } catch (error) {
      if (error instanceof InvalidResponse) return { ok: false, failure: { kind: 'invalid' } };
      throw error;
    }
  }

  const path = (...parts: string[]) => parts.map(part => `/${encodeURIComponent(part)}`).join('');

  return {
    state: (): Promise<Result<CollaborationState>> => send({ method: 'GET', path: '/state' }, parse.state),
    createThread: (body: string, anchor: TextAnchor | null, key: string): Promise<Result<Thread>> =>
      send({ method: 'POST', path: '/threads', body: { body, anchor }, idempotencyKey: key }, parse.thread),
    reply: (threadId: string, body: string, key: string): Promise<Result<Comment>> =>
      send({ method: 'POST', path: path('threads', threadId, 'comments'), body: { body }, idempotencyKey: key }, parse.comment),
    updateThread: (threadId: string, change: { resolved: boolean } | { anchor: TextAnchor | null }): Promise<Result<Thread>> =>
      send({ method: 'PATCH', path: path('threads', threadId), body: change }, parse.thread),
    deleteThread: (threadId: string): Promise<Result<void>> =>
      send({ method: 'DELETE', path: path('threads', threadId) }, parse.deletion),
    deleteComment: (threadId: string, commentId: string): Promise<Result<void>> =>
      send({ method: 'DELETE', path: path('threads', threadId, 'comments', commentId) }, parse.deletion),
    createNote: (body: string, key: string): Promise<Result<Note>> =>
      send({ method: 'POST', path: '/notes', body: { body }, idempotencyKey: key }, parse.note),
    updateNote: (noteId: string, body: string, version: number): Promise<Result<Note, Note>> =>
      send({ method: 'PATCH', path: path('notes', noteId), body: { body, version } }, parse.note, parse.note),
    setTask: (key: string, checked: boolean, version: number): Promise<Result<Task, Task>> =>
      send({ method: 'PUT', path: path('tasks', key), body: { checked, version } }, parse.task, parse.task),
  };
}

export type Api = ReturnType<typeof createApi>;

/**
 * Whether the server may have applied the change despite the failure: nothing came back,
 * a success response could not be read, or the server failed partway.
 */
export function mayHaveSaved(failure: Failure<unknown>): boolean {
  return failure.kind === 'network' || failure.kind === 'invalid' || (failure.kind === 'status' && failure.status >= 500);
}

/** Reader-facing explanation of a failure. */
export function describeFailure(failure: Failure<unknown>): string {
  switch (failure.kind) {
    case 'offline': return 'You are offline.';
    case 'network': return 'The comment server did not respond.';
    case 'conflict': return 'Someone else changed this first.';
    case 'invalid': return 'The comment server sent a response this page cannot read.';
    case 'status':
      if (failure.code === 'capacity_exceeded') return 'This document has reached its limit for comments, notes or tasks.';
      if (failure.status === 410) return 'This comment was deleted.';
      if (failure.status === 404) return 'Comments are not set up for this document.';
      if (failure.status === 413) return 'That is too long to save.';
      return `The comment server refused the change (HTTP ${failure.status}${failure.code ? `, ${failure.code}` : ''}).`;
  }
}
