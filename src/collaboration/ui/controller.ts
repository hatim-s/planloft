import { captureAnchor, resolveAnchor, type AnchorResolution } from '../anchors.js';
import type { CollaborationConfig, TextAnchor, Thread } from '../contracts.js';
import { createApi, describeFailure, idempotencyKey, mayHaveSaved, type Api } from './api.js';
import { changesContent, DocumentText } from './dom-text.js';
import { h, icon, ICONS } from './dom.js';
import { paintHighlights, pointFromCoordinates } from './highlights.js';
import { positionPopup } from './popup-position.js';
import { deleteFocusKey, renderPanel, type Actions } from './panel.js';
import { deliver, initialState, replySending, type Delivery, type Notice, type PendingNote, type PendingReply, type PendingThread, type Placement, type State } from './state.js';
import { NoteEditing } from './notes.js';
import { TaskBinder } from './tasks.js';
import { SelectionToolbar, type Offsets } from './toolbar.js';

const INTERACTIVE = 'a[href], button, input, select, textarea, label, summary, [contenteditable]:not([contenteditable="false"])';
const narrow = matchMedia('(max-width: 40rem)');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

/**
 * Owns runtime state and every mutation. The server is read once on mount and after
 * that only answers this reader's own changes; there is no polling.
 */
export class Collaboration implements Actions {
  readonly state: State = initialState();
  private readonly api: Api;
  private readonly ui: HTMLElement;
  private readonly panel: HTMLElement;
  private readonly launcher: HTMLButtonElement;
  private readonly notices: HTMLElement;
  private readonly announcer: HTMLElement;
  private readonly toolbar: SelectionToolbar;
  private readonly tasks: TaskBinder;
  private readonly notes: NoteEditing;
  private text: DocumentText | null = null;
  // Anchor resolution depends only on the anchor and the text, so it is cached until the text changes.
  private resolutions = new WeakMap<TextAnchor, AnchorResolution>();
  private resolvedText = '';
  private layoutFrame = 0;
  private renderQueued = false;
  private nextNotice = 1;
  private renderedNotices: Notice[] | null = null;

  constructor(private readonly config: CollaborationConfig) {
    this.api = createApi(config);
    this.toolbar = new SelectionToolbar({
      text: () => this.text,
      reattaching: () => this.state.reattaching !== null,
      inUi: target => target instanceof Node && this.ui.contains(target),
      comment: offsets => this.startComment(offsets),
      attach: offsets => void this.attach(offsets),
      cancelReattach: () => this.cancelReattach(),
    });
    this.launcher = h('button', { type: 'button', class: 'plc-launcher', 'aria-expanded': 'false', 'aria-controls': 'plc-panel', onclick: () => this.togglePanel() });
    this.panel = h('section', { id: 'plc-panel', class: 'plc-panel', role: 'dialog', 'aria-modal': 'false', 'aria-label': 'Comments and notes', hidden: true });
    this.panel.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      if (this.state.deleting) this.cancelDelete();
      else this.closePanel();
    });
    this.notices = h('div', { class: 'plc-notices', role: 'region', 'aria-label': 'Comment messages' });
    this.announcer = h('div', { class: 'plc-visually-hidden', role: 'status', 'aria-live': 'polite' });
    this.ui = h('div', { class: 'plc', 'data-planloft-collaboration': '' }, this.toolbar.element, this.launcher, this.panel, this.notices, this.announcer);
    this.ui.style.setProperty('--plc-document-font', getComputedStyle(document.body).fontFamily);
    document.body.append(this.ui);

    this.notes = new NoteEditing({ state: this.state, api: this.api, render: () => this.render(), announce: message => this.announce(message), notify: notice => this.notify(notice) });
    this.tasks = new TaskBinder({
      state: this.state,
      api: this.api,
      contentRoot: () => this.contentRoot(),
      notify: notice => this.notify(notice),
      dismiss: id => this.dismiss(id),
    });

    new MutationObserver(records => {
      if (records.some(changesContent)) this.scheduleLayout();
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
    document.addEventListener('click', this.onDocumentClick);
    document.addEventListener('keydown', this.onShortcut);
    addEventListener('online', () => this.setOnline(true));
    addEventListener('offline', () => this.setOnline(false));
    addEventListener('scroll', this.position, { capture: true, passive: true });
    addEventListener('resize', this.position, { passive: true });
    visualViewport?.addEventListener('resize', this.position);
    visualViewport?.addEventListener('scroll', this.position);
    new ResizeObserver(this.position).observe(this.panel);
    new ResizeObserver(this.position).observe(this.contentRoot());

    this.layout();
    void this.load();
  }

  // Data loading and layout

  private contentRoot(): Element {
    return (this.config.contentSelector && document.querySelector(this.config.contentSelector)) || document.body;
  }

  async load(): Promise<void> {
    this.state.load = { status: 'loading' };
    this.tasks.sync();
    this.render();
    const result = await this.api.state();
    if (result.ok) {
      this.state.threads = result.value.threads;
      this.state.notes = result.value.notes;
      this.state.tasks = new Map(result.value.tasks.map(task => [task.key, task]));
      this.state.load = { status: 'ready' };
    } else {
      this.state.load = { status: 'failed', failure: result.failure };
      this.announce(`Comments and notes could not load. ${describeFailure(result.failure)}`);
    }
    this.layout();
  }

  private scheduleLayout(): void {
    cancelAnimationFrame(this.layoutFrame);
    this.layoutFrame = requestAnimationFrame(() => this.layout());
  }

  /** Re-reads document text, re-resolves anchors and repaints. Runs after any page DOM change. */
  private layout(): void {
    this.text = new DocumentText(this.contentRoot());
    if (this.text.text !== this.resolvedText) {
      this.resolutions = new WeakMap();
      this.resolvedText = this.text.text;
    }
    this.state.placements = new Map(this.state.threads.map(thread => [thread.id, this.place(thread.anchor)]));
    this.tasks.sync();
    this.paint();
    this.render();
  }

  private place(anchor: TextAnchor | null): Placement {
    if (!anchor) return { status: 'document' };
    const text = this.text;
    if (!text) return { status: 'unattached' };
    let resolution = this.resolutions.get(anchor);
    if (!resolution) {
      resolution = resolveAnchor(text.text, anchor);
      this.resolutions.set(anchor, resolution);
    }
    if (resolution.status === 'unattached') return resolution;
    const { status, start, end } = resolution;
    return { status, start, end, range: text.rangeOf(start, end), current: text.index.chars.slice(start, end).join('') };
  }

  private paint(): void {
    const exact: Range[] = [];
    const approximate: Range[] = [];
    let active: Range | null = null;
    for (const thread of this.state.threads) {
      const placement = this.state.placements.get(thread.id);
      if (!placement || !('range' in placement)) continue;
      if (thread.id === this.state.activeThread) active = placement.range;
      else if (thread.resolved) continue;
      else (placement.status === 'exact' ? exact : approximate).push(placement.range);
    }
    for (const pending of this.state.pendingThreads) {
      const placement = this.place(pending.anchor);
      if ('range' in placement) exact.push(placement.range);
    }
    const draft = this.place(this.state.panel.open && this.state.panel.view === 'compose' && this.state.panel.tab === 'comments' ? this.state.composer.anchor : null);
    paintHighlights({ exact, approximate, active, draft: 'range' in draft ? draft.range : null });
  }

  private setOnline(online: boolean): void {
    this.state.online = online;
    if (online) {
      if (this.state.load.status === 'failed') void this.load();
      // Resend what was never sent and settle what may have been saved. Each resend keeps
      // its original key and text, so the server returns an earlier save instead of a copy.
      const resend = ({ delivery }: { delivery: Delivery }) => delivery.status === 'unknown' || (delivery.status === 'failed' && delivery.failure.kind === 'offline');
      for (const item of this.state.pendingThreads.filter(resend)) void this.deliverThread(item);
      for (const item of this.state.pendingReplies.filter(resend)) if (!this.state.busyThreads.has(item.threadId)) void this.deliverReply(item);
      for (const item of this.state.pendingNotes.filter(resend)) void this.deliverNote(item);
      // A note save carries its base version, so resending one that landed meets that save, not a copy.
      for (const [id, { failure }] of this.state.noteEdits) if (failure && failure.kind !== 'blank' && (failure.kind === 'offline' || mayHaveSaved(failure))) void this.saveNote(id);
    }
    this.render();
  }

  // Rendering

  private render(): void {
    if (this.renderQueued) return;
    this.renderQueued = true;
    queueMicrotask(() => {
      this.renderQueued = false;
      this.renderNow();
    });
  }

  private renderNow(): void {
    const { state } = this;
    const open = state.threads.filter(thread => !thread.resolved).length + state.pendingThreads.length;
    const label = !state.online ? 'Comments, offline' : state.load.status === 'loading' ? 'Comments, loading' : state.load.status === 'failed' ? 'Comments unavailable' : `Comments and notes, ${open} open ${open === 1 ? 'thread' : 'threads'}`;
    this.launcher.setAttribute('aria-label', label);
    this.launcher.setAttribute('aria-expanded', String(state.panel.open));
    this.launcher.dataset.state = state.load.status;
    this.launcher.replaceChildren(
      icon(state.load.status === 'failed' ? ICONS.warning : ICONS.comment),
      h('span', { class: 'plc-launcher-label', 'aria-hidden': 'true' }, 'Comments'),
      h('span', { class: 'plc-launcher-status', 'aria-hidden': 'true' }, !state.online ? 'Offline' : state.load.status === 'loading' ? 'Loading' : state.load.status === 'failed' ? 'Unavailable' : ''),
      h('span', { class: 'plc-launcher-count', 'aria-hidden': 'true' }, state.load.status === 'ready' ? String(open) : ''),
    );

    this.panel.hidden = !state.panel.open;
    if (state.panel.open) {
      // Rebuilding the panel replaces its elements, so carry focus, caret and scroll across by key.
      const focused = document.activeElement instanceof HTMLElement && this.panel.contains(document.activeElement) ? document.activeElement : null;
      const focusKey = focused?.dataset.focusKey;
      const caret = focused instanceof HTMLTextAreaElement ? [focused.selectionStart, focused.selectionEnd] as const : null;
      const scroller = this.panel.querySelector('.plc-panel-body');
      const scrollTop = scroller?.scrollTop ?? 0;
      this.panel.replaceChildren(...renderPanel(state, this));
      const nextScroller = this.panel.querySelector('.plc-panel-body');
      if (nextScroller) nextScroller.scrollTop = scrollTop;
      if (focusKey) {
        const next = this.panel.querySelector<HTMLElement>(`[data-focus-key="${CSS.escape(focusKey)}"]`);
        next?.focus({ preventScroll: true });
        if (next instanceof HTMLTextAreaElement && caret) next.setSelectionRange(caret[0], caret[1]);
      }
    }

    this.position();

    if (state.notices === this.renderedNotices) return;
    this.renderedNotices = state.notices;
    this.notices.replaceChildren(...state.notices.map(notice =>
      h('div', { class: `plc-notice plc-notice-${notice.tone}`, role: notice.tone === 'error' ? 'alert' : 'status' },
        h('p', { class: 'plc-notice-text' }, notice.message),
        notice.action && h('button', { type: 'button', class: 'plc-button plc-button-quiet', onclick: () => { this.dismiss(notice.id); notice.action?.run(); } }, notice.action.label),
        h('button', { type: 'button', class: 'plc-icon-button', 'aria-label': 'Dismiss', onclick: () => this.dismiss(notice.id) }, icon(ICONS.close)),
      )));
  }

  private readonly position = (): void => {
    if (this.panel.hidden) return;
    const { state } = this;
    const placement = state.panel.tab !== 'comments' ? null : state.activeThread
      ? state.placements.get(state.activeThread)
      : state.panel.view === 'compose' ? this.place(state.composer.anchor) : null;
    const range = placement && 'range' in placement ? placement.range : null;
    const rects = range ? Array.from(range.getClientRects()).filter(rect => rect.width > 0 && rect.height > 0) : [];
    const viewport = visualViewport;
    const bounds = { left: viewport?.offsetLeft ?? 0, top: viewport?.offsetTop ?? 0, width: viewport?.width ?? innerWidth, height: viewport?.height ?? innerHeight };
    this.panel.style.maxHeight = `${Math.max(0, Math.min(560, bounds.height - 24))}px`;
    this.panel.style.width = `${Math.max(0, Math.min(360, bounds.width - 24))}px`;
    const { left, top } = positionPopup({
      anchor: rects.find(rect => rect.bottom > bounds.top && rect.top < bounds.top + bounds.height) ?? rects[0] ?? this.launcher.getBoundingClientRect(),
      popup: { width: this.panel.offsetWidth, height: this.panel.offsetHeight },
      viewport: bounds,
      anchored: rects.length > 0,
    });
    this.panel.style.left = `${left}px`;
    this.panel.style.top = `${top}px`;
  };

  private focus(key: string): void {
    queueMicrotask(() => this.panel.querySelector<HTMLElement>(`[data-focus-key="${CSS.escape(key)}"]`)?.focus());
  }

  private announce(message: string): void {
    this.announcer.textContent = message;
  }

  notify(notice: Omit<Notice, 'id'>): number {
    const id = this.nextNotice++;
    this.state.notices = [...this.state.notices.slice(-2), { ...notice, id }];
    this.render();
    return id;
  }

  dismiss(id: number): void {
    this.state.notices = this.state.notices.filter(notice => notice.id !== id);
    this.render();
  }

  // Panel

  togglePanel(): void {
    if (this.state.panel.open) this.closePanel();
    else this.browseComments();
  }

  openPanel(focusKey = `tab-${this.state.panel.tab}`): void {
    this.state.panel.open = true;
    this.render();
    this.focus(focusKey);
  }

  closePanel(): void {
    this.state.panel.open = false;
    this.state.activeThread = null;
    this.state.deleting = null;
    this.paint();
    this.render();
    this.launcher.focus();
  }

  browseComments(): void {
    this.state.activeThread = null;
    this.state.deleting = null;
    Object.assign(this.state.panel, { tab: 'comments', view: 'browse' });
    this.paint();
    this.openPanel('new-comment');
  }

  composeComment(): void {
    this.state.activeThread = null;
    this.state.deleting = null;
    Object.assign(this.state.panel, { tab: 'comments', view: 'compose' });
    this.paint();
    this.openPanel('composer');
  }

  setTab(tab: State['panel']['tab']): void {
    this.state.panel.tab = tab;
    this.state.activeThread = null;
    this.state.deleting = null;
    this.state.panel.view = 'browse';
    this.paint();
    this.render();
    this.focus(`tab-${tab}`);
  }

  setFilter(filter: State['panel']['filter']): void {
    this.state.panel.filter = filter;
    this.render();
  }

  retryLoad(): void {
    void this.load();
  }

  // Threads

  private onDocumentClick = (event: MouseEvent) => {
    const target = event.target;
    // A click handler can rebuild the popup before the event reaches document.
    // The original propagation path still identifies that click as part of the UI.
    if (!(target instanceof Element) || event.composedPath().includes(this.ui)) return;
    if (target.closest(INTERACTIVE)) { if (this.state.panel.open) this.closePanelWithoutFocus(); return; }
    if (this.state.load.status !== 'ready') { if (this.state.panel.open) this.closePanelWithoutFocus(); return; }
    if (!getSelection()?.isCollapsed) return;
    const point = pointFromCoordinates(event.clientX, event.clientY);
    if (!point) { if (this.state.panel.open) this.closePanelWithoutFocus(); return; }
    let hit: { id: string; length: number } | null = null;
    for (const thread of this.state.threads) {
      const placement = this.state.placements.get(thread.id);
      if (thread.resolved || !placement || !('range' in placement)) continue;
      if (!placement.range.isPointInRange(point.node, point.offset)) continue;
      const length = placement.end - placement.start;
      if (!hit || length < hit.length) hit = { id: thread.id, length };
    }
    if (hit) this.openThread(hit.id);
    else if (this.state.panel.open) this.closePanelWithoutFocus();
  };

  private closePanelWithoutFocus(): void {
    this.state.panel.open = false;
    this.state.activeThread = null;
    this.state.deleting = null;
    this.paint();
    this.render();
  }

  private onShortcut = (event: KeyboardEvent) => {
    // The panel's own Escape handler runs first and may only have cancelled a deletion.
    if (event.key === 'Escape' && this.state.panel.open && !event.defaultPrevented) {
      event.preventDefault();
      this.closePanel();
      return;
    }
    if (!(event.metaKey || event.ctrlKey) || !event.altKey || event.code !== 'KeyM') return;
    event.preventDefault();
    const offsets = this.toolbar.current();
    if (offsets && this.state.reattaching) void this.attach(offsets);
    else if (offsets) this.startComment(offsets);
    else {
      this.composeComment();
    }
  };

  /** Opens a thread's card from its highlight. */
  openThread(id: string): void {
    const thread = this.state.threads.find(item => item.id === id);
    if (!thread) return;
    Object.assign(this.state.panel, { open: true, tab: 'comments', filter: thread.resolved ? 'resolved' : 'open' });
    this.state.activeThread = id;
    this.state.deleting = null;
    const placement = this.state.placements.get(id);
    if (placement && 'range' in placement) {
      const rect = placement.range.getBoundingClientRect();
      if (rect.bottom < 0 || rect.top > innerHeight) placement.range.startContainer.parentElement?.scrollIntoView({ block: 'center', behavior: 'instant' });
    }
    this.paint();
    this.render();
    queueMicrotask(() => {
      const card = this.panel.querySelector<HTMLElement>(`[data-focus-key="thread-${CSS.escape(id)}"]`);
      card?.focus({ preventScroll: true });
    });
  }

  /** Scrolls a thread's text into view and marks it active. */
  showInDocument(id: string): void {
    const placement = this.state.placements.get(id);
    this.state.activeThread = id;
    this.paint();
    this.render();
    if (!placement || !('range' in placement)) return;
    const element = placement.range.startContainer.parentElement;
    element?.scrollIntoView({ block: 'center', behavior: reducedMotion.matches ? 'auto' : 'smooth' });
  }

  private startComment(offsets: Offsets): void {
    if (!this.text) return;
    this.state.composer.anchor = captureAnchor(this.text.text, offsets.start, offsets.end, { revision: this.config.revision, documentId: this.config.documentId });
    Object.assign(this.state.panel, { open: true, tab: 'comments', filter: 'open', view: 'compose' });
    this.state.activeThread = null;
    this.state.deleting = null;
    getSelection()?.removeAllRanges();
    this.paint();
    this.openPanel('composer');
  }

  setComposer(body: string): void {
    this.state.composer.body = body;
  }

  clearComposerAnchor(): void {
    this.state.composer.anchor = null;
    this.paint();
    this.render();
    this.focus('composer');
  }

  submitThread(): void {
    const body = this.state.composer.body.trim();
    if (!body) return this.focus('composer');
    const pending: PendingThread = { key: idempotencyKey(), body, anchor: this.state.composer.anchor, delivery: { status: 'sending' } };
    this.state.pendingThreads.push(pending);
    this.state.composer = { body: '', anchor: null };
    this.state.panel.view = 'browse';
    this.paint();
    void this.deliverThread(pending);
  }

  private async deliverThread(pending: PendingThread): Promise<void> {
    const delivered = deliver(pending, () => this.api.createThread(pending.body, pending.anchor, pending.key));
    this.render();
    const thread = await delivered;
    if (thread) {
      this.state.pendingThreads = this.state.pendingThreads.filter(item => item !== pending);
      // A settled retry answers with the thread as first saved. One loaded since is newer.
      if (!this.state.threads.some(item => item.id === thread.id)) this.upsertThread(thread);
      if (this.state.panel.open && this.state.panel.tab === 'comments' && this.state.panel.view === 'browse' && !this.state.activeThread) this.openThread(thread.id);
      this.announce('Comment posted.');
    } else {
      this.announceUndelivered(pending.delivery, 'Comment');
    }
    this.paint();
    this.render();
  }

  private announceUndelivered(delivery: Delivery, noun: 'Comment' | 'Reply' | 'Note'): void {
    if (delivery.status === 'sending') return;
    const outcome = delivery.status === 'unknown' ? 'not confirmed' : noun === 'Note' ? 'not saved' : 'not posted';
    this.announce(`${noun} ${outcome}. ${describeFailure(delivery.failure)}`);
  }

  retryThread(key: string): void {
    const pending = this.state.pendingThreads.find(item => item.key === key);
    if (pending && pending.delivery.status !== 'sending') void this.deliverThread(pending);
  }

  /**
   * Moves a comment the server refused back into the composer; sending it again uses a new
   * key. One that may have been saved can only be retried, or the edit would post a copy.
   */
  editThread(key: string): void {
    const pending = this.state.pendingThreads.find(item => item.key === key);
    if (pending?.delivery.status !== 'failed') return;
    this.state.pendingThreads = this.state.pendingThreads.filter(item => item !== pending);
    const existing = this.state.composer.body.trim();
    this.state.composer = { body: existing ? `${existing}\n\n${pending.body}` : pending.body, anchor: pending.anchor };
    this.paint();
    this.render();
    this.composeComment();
  }

  /** Takes the server's copy of a thread, replies included. See `replySending` for why that list is current. */
  private upsertThread(thread: Thread): void {
    const index = this.state.threads.findIndex(item => item.id === thread.id);
    if (index < 0) this.state.threads.push(thread);
    else this.state.threads[index] = thread;
    this.state.placements.set(thread.id, this.place(thread.anchor));
  }

  setReplyDraft(threadId: string, body: string): void {
    this.state.replyDrafts.set(threadId, body);
  }

  submitReply(threadId: string): void {
    if (this.state.busyThreads.has(threadId)) return;
    const body = (this.state.replyDrafts.get(threadId) ?? '').trim();
    if (!body) return this.focus(`reply-${threadId}`);
    const pending: PendingReply = { key: idempotencyKey(), threadId, body, delivery: { status: 'sending' } };
    this.state.pendingReplies.push(pending);
    this.state.replyDrafts.delete(threadId);
    void this.deliverReply(pending);
  }

  private async deliverReply(pending: PendingReply): Promise<void> {
    const delivered = deliver(pending, () => this.api.reply(pending.threadId, pending.body, pending.key));
    this.render();
    const reply = await delivered;
    if (reply) {
      this.state.pendingReplies = this.state.pendingReplies.filter(item => item !== pending);
      const thread = this.state.threads.find(item => item.id === pending.threadId);
      if (thread && !thread.comments.some(comment => comment.id === reply.id)) thread.comments.push(reply);
      this.announce('Reply posted.');
    } else {
      this.announceUndelivered(pending.delivery, 'Reply');
    }
    this.render();
  }

  retryReply(key: string): void {
    const pending = this.state.pendingReplies.find(item => item.key === key);
    if (pending && pending.delivery.status !== 'sending' && !this.state.busyThreads.has(pending.threadId)) void this.deliverReply(pending);
  }

  editReply(key: string): void {
    const pending = this.state.pendingReplies.find(item => item.key === key);
    if (pending?.delivery.status !== 'failed') return;
    this.state.pendingReplies = this.state.pendingReplies.filter(item => item !== pending);
    const existing = (this.state.replyDrafts.get(pending.threadId) ?? '').trim();
    this.state.replyDrafts.set(pending.threadId, existing ? `${existing}\n\n${pending.body}` : pending.body);
    this.render();
    this.focus(`reply-${pending.threadId}`);
  }

  private async updateThread(id: string, change: { resolved: boolean } | { anchor: TextAnchor | null }, done: string): Promise<boolean> {
    if (this.state.busyThreads.has(id)) return false;
    if (replySending(this.state, id)) {
      this.notify({ tone: 'info', message: 'Wait for the reply to finish sending, then try again.' });
      return false;
    }
    this.state.busyThreads.add(id);
    this.render();
    const result = await this.api.updateThread(id, change);
    this.state.busyThreads.delete(id);
    if (result.ok) {
      this.upsertThread(result.value);
      this.announce(done);
    } else {
      const uncertain = mayHaveSaved(result.failure) ? ' It may not have saved; reload to check.' : '';
      this.notify({ tone: 'error', message: `${describeFailure(result.failure)}${uncertain}` });
    }
    this.paint();
    this.render();
    return result.ok;
  }

  requestDelete(threadId: string, commentId: string | null): void {
    if (this.state.busyThreads.has(threadId)) return;
    this.state.deleting = { threadId, commentId };
    this.render();
    // Cancel is the default, so a second Enter does not delete.
    this.focus(deleteFocusKey(threadId, commentId));
  }

  cancelDelete(): void {
    const target = this.state.deleting;
    if (!target || this.state.busyThreads.has(target.threadId)) return;
    this.state.deleting = null;
    this.render();
    this.focus(deleteFocusKey(target.threadId, target.commentId));
  }

  async confirmDelete(): Promise<void> {
    const target = this.state.deleting;
    if (!target || this.state.busyThreads.has(target.threadId)) return;
    if (replySending(this.state, target.threadId)) {
      this.notify({ tone: 'info', message: 'Wait for the reply to finish sending, then delete.' });
      return;
    }
    this.state.busyThreads.add(target.threadId);
    this.render();
    const result = target.commentId === null
      ? await this.api.deleteThread(target.threadId)
      : await this.api.deleteComment(target.threadId, target.commentId);
    this.state.busyThreads.delete(target.threadId);
    if (result.ok) {
      // The rendered list still holds the deleted row, so its neighbours are known.
      const after = target.commentId !== null ? `thread-${target.threadId}` : this.neighbourSummary(target.threadId) ?? 'new-comment';
      if (target.commentId === null) {
        this.state.threads = this.state.threads.filter(thread => thread.id !== target.threadId);
        this.state.placements.delete(target.threadId);
        this.state.pendingReplies = this.state.pendingReplies.filter(reply => reply.threadId !== target.threadId);
        this.state.replyDrafts.delete(target.threadId);
        if (this.state.reattaching === target.threadId) this.cancelReattach();
        if (this.state.activeThread === target.threadId) this.browseComments();
        else this.focus(after);
      } else {
        const thread = this.state.threads.find(thread => thread.id === target.threadId);
        if (thread) thread.comments = thread.comments.filter(comment => comment.id !== target.commentId);
        this.focus(after);
      }
      if (this.state.deleting === target) this.state.deleting = null;
      this.announce(target.commentId === null ? 'Thread deleted.' : 'Reply deleted.');
    } else {
      this.notify({ tone: 'error', message: `Deletion was not confirmed. ${describeFailure(result.failure)} Try deleting again to confirm it.` });
      if (this.state.deleting === target) this.focus('confirm-delete');
    }
    this.paint();
    this.render();
  }

  /** The focus key of the list row after a thread's row, or before it when it is last. */
  private neighbourSummary(threadId: string): string | null {
    const rows = Array.from(this.panel.querySelectorAll<HTMLElement>('[data-focus-key^="summary-"]'), row => row.dataset.focusKey);
    const index = rows.indexOf(`summary-${threadId}`);
    if (index < 0) return null;
    return rows[index + 1] ?? rows[index - 1] ?? null;
  }

  setResolved(id: string, resolved: boolean): void {
    void this.updateThread(id, { resolved }, resolved ? 'Thread resolved.' : 'Thread reopened.');
  }

  /** Confirms an approximate match by re-anchoring the thread to the text it found. */
  keepPlacement(id: string): void {
    const placement = this.state.placements.get(id);
    if (!this.text || !placement || placement.status !== 'approximate') return;
    const anchor = captureAnchor(this.text.text, placement.start, placement.end, { revision: this.config.revision, documentId: this.config.documentId });
    void this.updateThread(id, { anchor }, 'Comment attached to the current text.');
  }

  startReattach(id: string): void {
    if (this.state.busyThreads.has(id) || replySending(this.state, id)) return;
    this.state.reattaching = id;
    this.state.activeThread = id;
    this.paint();
    this.render();
    this.toolbar.update();
    if (narrow.matches) this.closePanel();
    this.announce('Select the text this comment belongs to, then choose Attach comment here.');
  }

  cancelReattach(): void {
    this.state.reattaching = null;
    this.render();
    this.toolbar.update();
  }

  private async attach(offsets: Offsets): Promise<void> {
    const id = this.state.reattaching;
    if (!id || !this.text) return;
    if (this.state.busyThreads.has(id) || replySending(this.state, id)) {
      this.notify({ tone: 'info', message: 'Wait for the pending change to finish, then select the text and try again.' });
      return;
    }
    const anchor = captureAnchor(this.text.text, offsets.start, offsets.end, { revision: this.config.revision, documentId: this.config.documentId });
    this.state.reattaching = null;
    getSelection()?.removeAllRanges();
    if (await this.updateThread(id, { anchor }, 'Comment attached to the selected text.')) this.openThread(id);
  }

  // Notes

  setNoteDraft(body: string): void {
    this.state.noteDraft = body;
  }

  submitNote(): void {
    const body = this.state.noteDraft.trim();
    if (!body) return this.focus('note-composer');
    const pending: PendingNote = { key: idempotencyKey(), body, delivery: { status: 'sending' } };
    this.state.pendingNotes.push(pending);
    this.state.noteDraft = '';
    void this.deliverNote(pending);
  }

  private async deliverNote(pending: PendingNote): Promise<void> {
    const delivered = deliver(pending, () => this.api.createNote(pending.body, pending.key));
    this.render();
    const note = await delivered;
    if (note) {
      this.state.pendingNotes = this.state.pendingNotes.filter(item => item !== pending);
      this.notes.adopt(note);
      this.announce('Note added.');
    } else {
      this.announceUndelivered(pending.delivery, 'Note');
    }
    this.render();
  }

  retryNote(key: string): void {
    const pending = this.state.pendingNotes.find(item => item.key === key);
    if (pending && pending.delivery.status !== 'sending') void this.deliverNote(pending);
  }

  editPendingNote(key: string): void {
    const pending = this.state.pendingNotes.find(item => item.key === key);
    if (pending?.delivery.status !== 'failed') return;
    this.state.pendingNotes = this.state.pendingNotes.filter(item => item !== pending);
    const existing = this.state.noteDraft.trim();
    this.state.noteDraft = existing ? `${existing}\n\n${pending.body}` : pending.body;
    this.render();
    this.focus('note-composer');
  }

  beginNoteEdit(id: string): void {
    if (this.notes.begin(id)) this.focus(`note-${id}`);
  }

  setNoteEdit(id: string, draft: string): void {
    this.notes.setDraft(id, draft);
  }

  cancelNoteEdit(id: string): void {
    this.notes.close(id);
    this.focus(`note-edit-${id}`);
  }

  saveNote(id: string): Promise<void> {
    return this.notes.save(id);
  }

  overwriteNote(id: string): void {
    this.notes.overwrite(id);
  }

  /** Drops the draft in favour of the newer saved version. */
  takeTheirs(id: string): void {
    this.notes.close(id);
    this.focus(`note-edit-${id}`);
  }
}
