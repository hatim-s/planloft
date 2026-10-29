import type { Note, Task, TextAnchor, Thread } from '../contracts.js';
import type { Failure } from './api.js';

/** A local change on its way to the server, or one that did not make it. */
export type Delivery = { status: 'sending' } | { status: 'failed'; failure: Failure<unknown> };

export interface PendingThread { key: string; body: string; anchor: TextAnchor | null; delivery: Delivery }
export interface PendingReply { key: string; threadId: string; body: string; delivery: Delivery }
export interface PendingNote { key: string; body: string; delivery: Delivery }

export interface NoteEdit {
  draft: string;
  /** The version the draft started from, or the newer one the reader chose to overwrite. */
  base: Note;
  saving: boolean;
  failure: Failure<unknown> | null;
  /** A newer saved version that arrived while this draft was open. */
  conflict: Note | null;
}

/** Where a thread sits in the current document text. */
export type Placement =
  | { status: 'exact' | 'approximate'; start: number; end: number; range: Range; current: string }
  | { status: 'unattached' }
  | { status: 'document' };

export type Load = { status: 'loading' } | { status: 'ready' } | { status: 'failed'; failure: Failure };

export interface Notice { id: number; message: string; tone: 'error' | 'info'; action?: { label: string; run: () => void } }

export interface State {
  load: Load;
  online: boolean;
  threads: Thread[];
  notes: Note[];
  tasks: Map<string, Task>;
  pendingThreads: PendingThread[];
  pendingReplies: PendingReply[];
  pendingNotes: PendingNote[];
  /** Threads with an update or deletion in flight. */
  busyThreads: Set<string>;
  deleting: { threadId: string; commentId: string | null } | null;
  noteEdits: Map<string, NoteEdit>;
  placements: Map<string, Placement>;
  composer: { body: string; anchor: TextAnchor | null };
  replyDrafts: Map<string, string>;
  noteDraft: string;
  notices: Notice[];
  panel: { open: boolean; tab: 'comments' | 'notes'; filter: 'open' | 'resolved'; view: 'browse' | 'compose' };
  activeThread: string | null;
  /** Thread waiting for the reader to select its new text. */
  reattaching: string | null;
}

export function initialState(): State {
  return {
    load: { status: 'loading' },
    online: navigator.onLine,
    threads: [],
    notes: [],
    tasks: new Map(),
    pendingThreads: [],
    pendingReplies: [],
    pendingNotes: [],
    busyThreads: new Set(),
    deleting: null,
    noteEdits: new Map(),
    placements: new Map(),
    composer: { body: '', anchor: null },
    replyDrafts: new Map(),
    noteDraft: '',
    notices: [],
    panel: { open: false, tab: 'comments', filter: 'open', view: 'browse' },
    activeThread: null,
    reattaching: null,
  };
}
