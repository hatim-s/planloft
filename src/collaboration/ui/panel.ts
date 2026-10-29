import { COLLABORATION_LIMITS, type Note, type Thread } from '../contracts.js';
import { describeFailure, mayHaveSaved } from './api.js';
import { h, icon, ICONS, time } from './dom.js';
import { replySending, type Delivery, type PendingNote, type PendingReply, type PendingThread, type Placement, type State } from './state.js';

/** What the panel can ask the controller to do. These are class methods, so always call them through `actions.`; never pass one as a bare callback. */
export interface Actions {
  closePanel(): void;
  browseComments(): void;
  composeComment(): void;
  openThread(id: string): void;
  requestDelete(threadId: string, commentId: string | null): void;
  cancelDelete(): void;
  confirmDelete(): void;
  setTab(tab: State['panel']['tab']): void;
  setFilter(filter: State['panel']['filter']): void;
  retryLoad(): void;
  cancelReattach(): void;
  setComposer(body: string): void;
  clearComposerAnchor(): void;
  submitThread(): void;
  retryThread(key: string): void;
  editThread(key: string): void;
  showInDocument(id: string): void;
  setReplyDraft(threadId: string, body: string): void;
  submitReply(threadId: string): void;
  retryReply(key: string): void;
  editReply(key: string): void;
  setResolved(id: string, resolved: boolean): void;
  keepPlacement(id: string): void;
  startReattach(id: string): void;
  setNoteDraft(body: string): void;
  submitNote(): void;
  retryNote(key: string): void;
  editPendingNote(key: string): void;
  beginNoteEdit(id: string): void;
  setNoteEdit(id: string, draft: string): void;
  cancelNoteEdit(id: string): void;
  saveNote(id: string): Promise<void>;
  overwriteNote(id: string): void;
  takeTheirs(id: string): void;
}

type View = { state: State; actions: Actions };

// The panel is rebuilt on every change, so nothing in it is a live region; recreated
// live regions are announced again. The controller announces changes through one
// persistent status element instead.

// Shared form behaviour: Ctrl/Cmd+Enter submits, typing updates the draft in state.
function textarea(props: { key: string; label: string; value: string; placeholder: string; rows: number; onInput: (value: string) => void }): HTMLElement[] {
  const id = `plc-field-${props.key}`;
  return [
    h('label', { class: 'plc-visually-hidden', for: id }, props.label),
    h('textarea', {
      id,
      class: 'plc-textarea',
      rows: props.rows,
      placeholder: props.placeholder,
      maxlength: COLLABORATION_LIMITS.bodyCharacters,
      value: props.value,
      'data-focus-key': props.key,
      oninput: (event: Event) => props.onInput((event.target as HTMLTextAreaElement).value),
      onkeydown: (event: Event) => {
        const key = event as KeyboardEvent;
        if (key.key === 'Enter' && (key.metaKey || key.ctrlKey)) {
          key.preventDefault();
          (event.target as HTMLTextAreaElement).form?.requestSubmit();
        }
      },
    }),
  ];
}

function form(onSubmit: () => void, className: string, ...children: (Node | null | false)[]): HTMLFormElement {
  return h('form', {
    class: className,
    onsubmit: (event: Event) => {
      event.preventDefault();
      onSubmit();
    },
  }, ...children);
}

const button = (label: string, onClick: () => void, variant: 'primary' | 'quiet' = 'quiet', extra: Record<string, string> = {}) =>
  h('button', { type: 'button', class: `plc-button plc-button-${variant}`, onclick: onClick, ...extra }, label);

const body = (text: string) => h('p', { class: 'plc-body' }, text);

// The submit button sits inside the field, the way a chat composer reads.
const field = (input: HTMLElement[], label: string) =>
  h('div', { class: 'plc-field' }, ...input,
    h('button', { type: 'submit', class: 'plc-send', 'aria-label': label, title: label }, icon(ICONS.send)));

// Edit is offered only for a refusal. Text that may already be saved must be settled by
// Retry, which resends the same text under the same key.
function deliveryLine(delivery: Delivery, noun: string, actions: { retry: () => void; edit: () => void; blocked?: boolean }): HTMLElement {
  if (delivery.status === 'sending') return h('p', { class: 'plc-delivery' }, 'Sending…');
  const { failure } = delivery;
  const message = delivery.status === 'unknown'
    ? `Not confirmed. ${describeFailure(failure)} It may already be ${noun}. Retry checks without ${noun === 'saved' ? 'saving' : 'posting'} it twice${failure.kind === 'offline' ? ', and runs when you reconnect' : ''}.`
    : failure.kind === 'offline'
      ? `Not ${noun}. You are offline; it will send when you reconnect.`
      : `Not ${noun}. ${describeFailure(failure)}`;
  const retry = button('Retry', () => { if (!actions.blocked) actions.retry(); }, 'quiet', { 'aria-disabled': String(actions.blocked ?? false) });
  return h('div', { class: 'plc-delivery plc-delivery-failed' },
    h('p', {}, message),
    h('div', { class: 'plc-actions' }, retry, delivery.status === 'failed' && button('Edit', actions.edit)));
}

function banners({ state, actions }: View): HTMLElement[] {
  const result: HTMLElement[] = [];
  if (state.load.status === 'loading') result.push(h('p', { class: 'plc-banner' }, 'Loading comments and notes…'));
  if (state.load.status === 'failed') {
    const offline = state.load.failure.kind === 'offline';
    result.push(h('div', { class: 'plc-banner plc-banner-error' },
      h('p', {}, offline ? 'You are offline. Comments and notes load when you reconnect.' : `Comments and notes could not load. ${describeFailure(state.load.failure)}`),
      !offline && h('div', { class: 'plc-actions' }, button('Try again', () => actions.retryLoad()))));
  }
  if (state.load.status === 'ready' && !state.online) {
    result.push(h('p', { class: 'plc-banner' }, 'You are offline. What you write stays here and sends when you reconnect.'));
  }
  if (state.reattaching) {
    result.push(h('div', { class: 'plc-banner plc-banner-accent' },
      h('p', {}, 'Select the text this comment belongs to, then choose Attach comment here.'),
      h('div', { class: 'plc-actions' }, button('Cancel', () => actions.cancelReattach()))));
  }
  return result;
}

function tabs({ state, actions }: View): HTMLElement {
  const openCount = state.threads.filter(thread => !thread.resolved).length + state.pendingThreads.length;
  const noteCount = state.notes.length + state.pendingNotes.length;
  const entries = [['comments', 'Comments', openCount], ['notes', 'Notes', noteCount]] as const;
  const list = h('div', {
    class: 'plc-tabs',
    role: 'tablist',
    'aria-label': 'Collaboration',
    onkeydown: (event: Event) => {
      const key = (event as KeyboardEvent).key;
      if (key === 'ArrowLeft' || key === 'ArrowRight') actions.setTab(state.panel.tab === 'comments' ? 'notes' : 'comments');
    },
  });
  for (const [tab, label, count] of entries) {
    const selected = state.panel.tab === tab;
    list.append(h('button', {
      type: 'button',
      role: 'tab',
      id: `plc-tab-${tab}`,
      class: 'plc-tab',
      'aria-selected': String(selected),
      'aria-controls': 'plc-tabpanel',
      tabindex: selected ? 0 : -1,
      'data-focus-key': `tab-${tab}`,
      onclick: () => actions.setTab(tab),
    }, label, state.load.status === 'ready' && h('span', { class: 'plc-count' }, String(count))));
  }
  return list;
}

export function renderPanel(state: State, actions: Actions): HTMLElement[] {
  const view = { state, actions };
  const detail = state.panel.tab === 'comments' && (state.activeThread !== null || state.panel.view === 'compose');
  const thread = state.threads.find(item => item.id === state.activeThread);
  const content = state.load.status !== 'ready' ? [] : state.panel.tab === 'notes' ? notes(view)
    : thread ? [threadCard(view, thread, state.placements.get(thread.id) ?? { status: 'unattached' })]
    : state.panel.view === 'compose' ? [composer(view)] : comments(view);
  return [
    h('header', { class: 'plc-panel-header' },
      detail
        ? h('button', { type: 'button', class: 'plc-back', 'data-focus-key': 'back', onclick: () => actions.browseComments() }, icon(ICONS.back), 'All comments')
        : tabs(view),
      h('div', { class: 'plc-header-actions' },
        detail && thread && resolveToggle(view, thread),
        h('button', { type: 'button', class: 'plc-icon-button', 'aria-label': 'Close comments', title: 'Close', 'data-focus-key': 'close', onclick: () => actions.closePanel() }, icon(ICONS.close)))),
    h('div', { class: 'plc-panel-body', id: 'plc-tabpanel', ...(detail ? {} : { role: 'tabpanel', 'aria-labelledby': `plc-tab-${state.panel.tab}` }) },
      ...banners(view), ...content),
  ];
}

// Comments

// The inner span carries the highlight so it wraps line by line like the marked text in the page.
function quote(text: string): HTMLElement {
  return h('span', { class: 'plc-quote' }, h('span', { class: 'plc-quote-text' }, text));
}

function composer(view: View): HTMLElement {
  const { state, actions } = view;
  const anchor = state.composer.anchor;
  return form(() => actions.submitThread(), 'plc-composer',
    anchor
      ? h('div', { class: 'plc-composer-scope' },
        quote(anchor.quote),
        h('button', { type: 'button', class: 'plc-icon-button', 'aria-label': 'Comment on the whole document instead', title: 'Comment on the whole document instead', onclick: () => actions.clearComposerAnchor() }, icon(ICONS.close)))
      : h('p', { class: 'plc-hint' }, 'Commenting on the whole document. To comment on a passage, select it in the document.'),
    field(textarea({ key: 'composer', label: anchor ? 'Comment on the selected text' : 'Comment on the whole document', value: state.composer.body, placeholder: 'Add a comment', rows: 2, onInput: value => actions.setComposer(value) }), 'Comment'));
}

function comments(view: View): HTMLElement[] {
  const { state, actions } = view;
  const resolvedCount = state.threads.filter(thread => thread.resolved).length;
  const openCount = state.threads.length - resolvedCount + state.pendingThreads.length;
  const filter = h('div', { class: 'plc-filter', role: 'group', 'aria-label': 'Show threads' },
    ...([['open', `Open ${openCount}`], ['resolved', `Resolved ${resolvedCount}`]] as const).map(([value, label]) =>
      h('button', { type: 'button', class: 'plc-filter-option', 'aria-pressed': String(state.panel.filter === value), onclick: () => actions.setFilter(value) }, label)));

  return [
    h('div', { class: 'plc-overview-bar' },
      filter,
      h('button', { type: 'button', class: 'plc-button plc-button-quiet', 'data-focus-key': 'new-comment', onclick: () => actions.composeComment() },
        icon(ICONS.plus), state.composer.body ? 'Continue draft' : 'New comment')),
    ...threadList(view),
  ];
}

function threadList(view: View): HTMLElement[] {
  const { state } = view;
  const placementOf = (thread: Thread): Placement => state.placements.get(thread.id) ?? { status: 'unattached' };
  if (state.panel.filter === 'resolved') {
    const resolved = state.threads.filter(thread => thread.resolved).reverse();
    return resolved.length ? resolved.map(thread => threadSummary(view, thread, placementOf(thread))) : [h('p', { class: 'plc-empty' }, 'No resolved threads.')];
  }
  const open = state.threads.filter(thread => !thread.resolved).map(thread => ({ thread, placement: placementOf(thread) }));
  const positioned = open.filter(item => 'range' in item.placement)
    .sort((a, b) => ('start' in a.placement ? a.placement.start : 0) - ('start' in b.placement ? b.placement.start : 0));
  const whole = open.filter(item => item.placement.status === 'document');
  const lost = open.filter(item => item.placement.status === 'unattached');
  const cards = [
    ...state.pendingThreads.map(pending => pendingThreadCard(view, pending)),
    ...positioned.map(item => threadSummary(view, item.thread, item.placement)),
    ...whole.map(item => threadSummary(view, item.thread, item.placement)),
  ];
  if (lost.length) {
    cards.push(h('h3', { class: 'plc-section-title' }, 'Text no longer in the document'));
    cards.push(...lost.map(item => threadSummary(view, item.thread, item.placement)));
  }
  return cards.length ? cards : [h('p', { class: 'plc-empty' }, 'No open comments. Select text in the document and choose Comment, or choose New comment for the whole document.')];
}

function threadSummary(view: View, thread: Thread, placement: Placement): HTMLElement {
  const { state, actions } = view;
  const replies = thread.comments.length;
  const confirmation = deleteConfirmation(view, thread.id, null);
  return h('div', { class: 'plc-thread-row', 'data-placement': placement.status, 'data-confirming': String(confirmation !== null) },
  h('button', {
    type: 'button', class: 'plc-thread-summary', 'data-focus-key': `summary-${thread.id}`,
    onclick: () => actions.openThread(thread.id),
  },
  thread.anchor ? h('span', { class: 'plc-summary-scope' }, h('span', { class: 'plc-quote-text' }, thread.anchor.quote)) : h('span', { class: 'plc-scope' }, 'Whole document'),
  h('span', { class: 'plc-summary-body' }, thread.body),
  h('span', { class: 'plc-summary-meta' }, time(thread.createdAt),
    replies > 0 && h('span', {}, `${replies} ${replies === 1 ? 'reply' : 'replies'}`),
    placement.status === 'unattached' ? h('span', {}, 'Unattached') : thread.resolved && h('span', {}, 'Resolved'))),
  confirmation ?? h('button', {
    type: 'button', class: 'plc-icon-button plc-summary-delete',
    'aria-label': 'Delete thread', title: 'Delete thread',
    'data-focus-key': deleteFocusKey(thread.id, null), disabled: state.busyThreads.has(thread.id),
    onclick: () => actions.requestDelete(thread.id, null),
  }, icon(ICONS.trash)));
}

/** Shared by a Delete trigger and its confirmation's Cancel, so focus moves between them across renders. */
export const deleteFocusKey = (threadId: string, commentId: string | null) => `delete-${threadId}-${commentId ?? 'thread'}`;

function deleteConfirmation(view: View, threadId: string, commentId: string | null): HTMLElement | null {
  const { state, actions } = view;
  const confirming = state.deleting?.threadId === threadId && state.deleting.commentId === commentId;
  if (!confirming) return null;
  const busy = state.busyThreads.has(threadId);
  const focusKey = deleteFocusKey(threadId, commentId);
  const titleId = `plc-delete-title-${threadId}-${commentId ?? 'thread'}`;
  return h('div', { class: 'plc-delete-confirm', role: 'group', 'aria-labelledby': titleId, 'aria-busy': String(busy) },
    h('div', { class: 'plc-delete-copy' },
      h('p', { id: titleId, class: 'plc-delete-title' }, commentId === null ? 'Delete this thread?' : 'Delete this reply?'),
      h('p', { class: 'plc-delete-description' }, commentId === null ? 'This comment and all replies will be removed.' : 'This reply will be removed.')),
    // aria-disabled rather than disabled while deleting, so the focused button keeps focus.
    h('div', { class: 'plc-actions' },
      h('button', { type: 'button', class: 'plc-button plc-button-quiet', 'aria-disabled': String(busy), 'data-focus-key': focusKey, onclick: () => actions.cancelDelete() }, 'Cancel'),
      h('button', { type: 'button', class: 'plc-button plc-button-danger', 'aria-disabled': String(busy), 'data-focus-key': 'confirm-delete', onclick: () => actions.confirmDelete() }, busy ? 'Deleting…' : 'Delete')));
}

function deletion(view: View, threadId: string, commentId: string | null): HTMLElement {
  const { state, actions } = view;
  const busy = state.busyThreads.has(threadId);
  const confirmation = deleteConfirmation(view, threadId, commentId);
  if (confirmation) return confirmation;
  return h('button', { type: 'button', class: 'plc-delete', disabled: busy, 'aria-label': commentId === null ? 'Delete thread' : 'Delete reply', 'data-focus-key': deleteFocusKey(threadId, commentId), onclick: () => actions.requestDelete(threadId, commentId) }, 'Delete');
}

// A thread update waits while it saves or while a reply sends (see replySending).
const updateBlocked = (state: State, threadId: string) => state.busyThreads.has(threadId) || replySending(state, threadId);

// Lives in the popup header. While blocked it stays focusable (aria-disabled, not disabled) so focus is not dropped.
function resolveToggle({ state, actions }: View, thread: Thread): HTMLElement {
  const blocked = updateBlocked(state, thread.id);
  return h('button', {
    type: 'button',
    class: 'plc-button plc-button-quiet plc-resolve',
    'data-resolved': String(thread.resolved),
    'aria-disabled': String(blocked),
    'data-focus-key': `resolve-${thread.id}`,
    title: replySending(state, thread.id) ? 'Available once the reply has sent' : undefined,
    onclick: () => { if (!blocked) actions.setResolved(thread.id, !thread.resolved); },
  }, icon(thread.resolved ? ICONS.reopen : ICONS.check), state.busyThreads.has(thread.id) ? 'Saving…' : thread.resolved ? 'Reopen' : 'Resolve');
}

function placementNote({ state, actions }: View, thread: Thread, placement: Placement): HTMLElement | null {
  if (thread.resolved) return null;
  const blocked = { 'aria-disabled': String(updateBlocked(state, thread.id)) };
  const reattach = button('Attach to other text', () => actions.startReattach(thread.id), 'quiet', blocked);
  if (placement.status === 'approximate') {
    return h('div', { class: 'plc-placement' },
      h('p', {}, 'The quoted text has changed. This comment now points at the closest match: ', h('q', { class: 'plc-current' }, placement.current)),
      h('div', { class: 'plc-actions' }, button('Keep it here', () => actions.keepPlacement(thread.id), 'quiet', blocked), reattach));
  }
  if (placement.status === 'unattached') {
    return h('div', { class: 'plc-placement' },
      h('p', {}, 'The quoted text is no longer in the document.'),
      h('div', { class: 'plc-actions' }, reattach));
  }
  return null;
}

function threadCard(view: View, thread: Thread, placement: Placement): HTMLElement {
  const { state, actions } = view;
  const busy = state.busyThreads.has(thread.id);
  const replies = state.pendingReplies.filter(reply => reply.threadId === thread.id);
  const subject = thread.anchor
    ? 'range' in placement
      ? h('button', { type: 'button', class: 'plc-quote-button', title: 'Show in document', onclick: () => actions.showInDocument(thread.id) }, quote(thread.anchor.quote))
      : h('div', { class: 'plc-quote-detached' }, quote(thread.anchor.quote))
    : h('p', { class: 'plc-scope' }, 'Whole document');
  return h('article', {
    class: 'plc-thread',
    tabindex: -1,
    'data-focus-key': `thread-${thread.id}`,
    'data-active': String(state.activeThread === thread.id),
    'data-placement': placement.status,
    'aria-label': thread.anchor ? `Comment on “${thread.anchor.quote.slice(0, 80)}”` : 'Comment on the whole document',
  },
  subject,
  placementNote(view, thread, placement),
  h('ol', { class: 'plc-comments' },
    h('li', { class: 'plc-comment' }, body(thread.body), h('div', { class: 'plc-comment-meta' }, time(thread.createdAt), deletion(view, thread.id, null))),
    ...thread.comments.map(comment => h('li', { class: 'plc-comment' }, body(comment.body), h('div', { class: 'plc-comment-meta' }, time(comment.createdAt), deletion(view, thread.id, comment.id)))),
    ...replies.map(reply => pendingReply(view, reply))),
  thread.resolved
    ? h('p', { class: 'plc-hint' }, 'Resolved. Reopen the thread to reply.')
    : !busy && form(() => actions.submitReply(thread.id), 'plc-reply',
      field(textarea({ key: `reply-${thread.id}`, label: 'Reply', value: state.replyDrafts.get(thread.id) ?? '', placeholder: 'Reply', rows: 1, onInput: value => actions.setReplyDraft(thread.id, value) }), 'Reply')));
}

function pendingThreadCard({ actions }: View, pending: PendingThread): HTMLElement {
  return h('article', { class: 'plc-thread', 'data-delivery': pending.delivery.status },
    pending.anchor ? h('div', { class: 'plc-quote-detached' }, quote(pending.anchor.quote)) : h('p', { class: 'plc-scope' }, 'Whole document'),
    h('ol', { class: 'plc-comments' }, h('li', { class: 'plc-comment' }, body(pending.body))),
    deliveryLine(pending.delivery, 'posted', { retry: () => actions.retryThread(pending.key), edit: () => actions.editThread(pending.key) }));
}

function pendingReply({ state, actions }: View, reply: PendingReply): HTMLElement {
  return h('li', { class: 'plc-comment', 'data-delivery': reply.delivery.status },
    body(reply.body),
    deliveryLine(reply.delivery, 'posted', { retry: () => actions.retryReply(reply.key), edit: () => actions.editReply(reply.key), blocked: state.busyThreads.has(reply.threadId) }));
}

// Notes

function notes(view: View): HTMLElement[] {
  const { state, actions } = view;
  const composer = form(() => actions.submitNote(), 'plc-composer',
    ...textarea({ key: 'note-composer', label: 'New note', value: state.noteDraft, placeholder: 'Write a note anyone reading can edit', rows: 3, onInput: value => actions.setNoteDraft(value) }),
    h('div', { class: 'plc-actions' }, h('button', { type: 'submit', class: 'plc-button plc-button-primary' }, 'Add note')));
  const cards = [
    ...state.pendingNotes.map(pending => pendingNoteCard(view, pending)),
    ...[...state.notes].reverse().map(note => noteCard(view, note)),
  ];
  return [composer, ...(cards.length ? cards : [h('p', { class: 'plc-empty' }, 'No notes yet. Everyone who can read this document can read and edit its notes.')])];
}

function pendingNoteCard({ actions }: View, pending: PendingNote): HTMLElement {
  return h('article', { class: 'plc-note', 'data-delivery': pending.delivery.status },
    body(pending.body),
    deliveryLine(pending.delivery, 'saved', { retry: () => actions.retryNote(pending.key), edit: () => actions.editPendingNote(pending.key) }));
}

function noteCard({ state, actions }: View, note: Note): HTMLElement {
  const edit = state.noteEdits.get(note.id);
  const edited = note.updatedAt !== note.createdAt;
  if (!edit) {
    return h('article', { class: 'plc-note' },
      body(note.body),
      h('footer', { class: 'plc-note-footer' },
        h('span', { class: 'plc-meta' }, edited ? 'Edited ' : 'Added ', time(note.updatedAt)),
        button('Edit', () => actions.beginNoteEdit(note.id), 'quiet', { 'data-focus-key': `note-edit-${note.id}` })));
  }
  const conflict = edit.conflict;
  return h('article', { class: 'plc-note', 'data-editing': 'true' },
    form(() => void actions.saveNote(note.id), 'plc-note-form',
      ...textarea({ key: `note-${note.id}`, label: 'Edit note', value: edit.draft, placeholder: 'Note', rows: 5, onInput: value => actions.setNoteEdit(note.id, value) }),
      conflict && h('div', { class: 'plc-conflict' },
        h('p', {}, 'Someone saved a newer version while you were editing. Your text is still in the editor above.'),
        h('p', { class: 'plc-meta' }, 'Their version, saved ', time(conflict.updatedAt)),
        h('div', { class: 'plc-conflict-text' }, body(conflict.body)),
        h('div', { class: 'plc-actions' },
          button('Save my version', () => actions.overwriteNote(note.id), 'primary'),
          button('Use their version', () => actions.takeTheirs(note.id)))),
      edit.failure && h('p', { class: 'plc-delivery plc-delivery-failed' },
        edit.failure.kind === 'blank'
          ? 'A note needs some text. Write something, or choose Cancel to keep the saved version.'
          : mayHaveSaved(edit.failure)
            ? `Not confirmed. ${describeFailure(edit.failure)} Save again to check.`
            : `Not saved. ${describeFailure(edit.failure)}`),
      !conflict && h('div', { class: 'plc-actions' },
        h('button', { type: 'submit', class: 'plc-button plc-button-primary', 'aria-disabled': String(edit.saving) }, edit.saving ? 'Saving…' : 'Save'),
        button('Cancel', () => actions.cancelNoteEdit(note.id)))));
}
