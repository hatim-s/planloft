import type { DocumentText } from './dom-text.js';
import { h, icon, ICONS } from './dom.js';

export type Offsets = { start: number; end: number };

type Host = {
  text(): DocumentText | null;
  reattaching(): boolean;
  inUi(target: EventTarget | null): boolean;
  comment(offsets: Offsets): void;
  attach(offsets: Offsets): void;
  cancelReattach(): void;
};

const coarse = matchMedia('(pointer: coarse)');

/**
 * The floating button over a text selection. It reads the live selection on demand and
 * keeps no layout state between updates; positions are viewport coordinates computed
 * at display time and never stored.
 */
export class SelectionToolbar {
  readonly element: HTMLElement;
  private offsets: Offsets | null = null;
  private pointerDown = false;
  private frame = 0;

  constructor(private readonly host: Host) {
    this.element = h('div', { class: 'plc-toolbar', role: 'toolbar', 'aria-label': 'Selected text', hidden: true });
    // Keep the document selection when the button is pressed.
    this.element.addEventListener('pointerdown', event => event.preventDefault());
    document.addEventListener('selectionchange', this.schedule);
    document.addEventListener('pointerdown', event => {
      if (!this.host.inUi(event.target)) this.pointerDown = true;
    });
    document.addEventListener('pointerup', () => {
      this.pointerDown = false;
      this.schedule();
    });
    addEventListener('scroll', this.reposition, { capture: true, passive: true });
    addEventListener('resize', this.reposition, { passive: true });
  }

  /** Offsets of the current selection when it covers document text. */
  current(): Offsets | null {
    return this.read()?.offsets ?? null;
  }

  private read(): { range: Range; offsets: Offsets } | null {
    const selection = getSelection();
    const text = this.host.text();
    if (!selection || selection.isCollapsed || !selection.rangeCount || !text) return null;
    const range = selection.getRangeAt(0);
    if (this.host.inUi(range.commonAncestorContainer)) return null;
    const offsets = text.offsetsOf(range);
    return offsets ? { range, offsets } : null;
  }

  readonly schedule = () => {
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => this.update());
  };

  private readonly reposition = () => {
    if (!this.element.hidden) this.schedule();
  };

  update(): void {
    const found = this.pointerDown ? null : this.read();
    this.offsets = found?.offsets ?? null;
    if (!found) {
      this.element.hidden = true;
      return;
    }
    this.element.replaceChildren(...this.buttons());
    this.element.hidden = false;
    this.place(found.range);
  }

  hide(): void {
    this.offsets = null;
    this.element.hidden = true;
  }

  private buttons(): HTMLElement[] {
    const take = (run: (offsets: Offsets) => void) => () => {
      if (this.offsets) run(this.offsets);
      this.hide();
    };
    if (this.host.reattaching()) {
      return [
        h('button', { type: 'button', class: 'plc-toolbar-button', onclick: take(offsets => this.host.attach(offsets)) }, icon(ICONS.check), 'Attach comment here'),
        h('button', { type: 'button', class: 'plc-toolbar-button plc-toolbar-quiet', onclick: () => { this.host.cancelReattach(); this.hide(); } }, 'Cancel'),
      ];
    }
    return [
      h('button', {
        type: 'button',
        class: 'plc-toolbar-button',
        'aria-keyshortcuts': 'Control+Alt+M Meta+Alt+M',
        title: 'Comment (Ctrl+Alt+M or ⌘⌥M)',
        onclick: take(offsets => this.host.comment(offsets)),
      }, icon(ICONS.comment), 'Comment'),
    ];
  }

  private place(range: Range): void {
    const rects = Array.from(range.getClientRects()).filter(rect => rect.width > 0 || rect.height > 0);
    const first = rects[0] ?? range.getBoundingClientRect();
    const last = rects.at(-1) ?? first;
    const { offsetWidth: width, offsetHeight: height } = this.element;
    const gap = 8;
    // Touch browsers draw their own selection menu above the text, so go below it there.
    const below = coarse.matches || first.top - height - gap < gap;
    const anchor = below ? last : first;
    const top = below ? Math.min(anchor.bottom + gap, innerHeight - height - gap) : anchor.top - height - gap;
    const left = Math.min(Math.max(gap, anchor.left + anchor.width / 2 - width / 2), innerWidth - width - gap);
    this.element.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
  }
}
