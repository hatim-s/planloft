import { buildTextIndex, offsetInNode, pointAt, trimOffsets, type TextChunk, type TextIndex } from './text-index.js';

// Content that is not prose, or that belongs to the runtime or theme chrome.
const EXCLUDED_TAGS = new Set(['script', 'style', 'noscript', 'template', 'textarea', 'select', 'svg', 'math', 'canvas', 'iframe', 'object', 'video', 'audio', 'button', 'input']);
const EXCLUDED_SELECTOR = '[data-planloft-collaboration], .planloft-theme-selector, .planloft-comments, [data-planloft-ignore]';
// Tag names rather than computed style, so offsets do not change with viewport or CSS.
const BLOCK_TAGS = new Set([
  'address', 'article', 'aside', 'blockquote', 'br', 'caption', 'dd', 'details', 'dialog', 'div', 'dl', 'dt',
  'fieldset', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hgroup',
  'hr', 'legend', 'li', 'main', 'nav', 'ol', 'p', 'pre', 'section', 'summary', 'table', 'tbody', 'td', 'tfoot',
  'th', 'thead', 'tr', 'ul',
]);

export function isExcluded(element: Element): boolean {
  return EXCLUDED_TAGS.has(element.localName) || element.matches(EXCLUDED_SELECTOR);
}

function collect(element: Element, chunks: TextChunk<Text>[]): void {
  for (let child = element.firstChild; child; child = child.nextSibling) {
    if (child instanceof Text) chunks.push({ node: child, data: child.data });
    else if (child instanceof Element && !isExcluded(child)) {
      const block = BLOCK_TAGS.has(child.localName);
      if (block) chunks.push('break');
      collect(child, chunks);
      if (block) chunks.push('break');
    }
  }
}

/** The normalized text of one content root, with offset and Range mapping. */
export class DocumentText {
  readonly index: TextIndex<Text>;
  private readonly positions: Map<Text, number>;

  constructor(readonly root: Element) {
    const chunks: TextChunk<Text>[] = [];
    if (!isExcluded(root)) collect(root, chunks);
    this.index = buildTextIndex(chunks);
    this.positions = new Map(this.index.nodes.map((node, i) => [node, i]));
  }

  get text(): string {
    return this.index.text;
  }

  /** Code-point offsets of the text a DOM range covers, without edge spaces; null when it covers none. */
  offsetsOf(range: Range): { start: number; end: number } | null {
    const start = this.offsetOf(range.startContainer, range.startOffset, 'start');
    const end = this.offsetOf(range.endContainer, range.endOffset, 'end');
    return trimOffsets(this.index, start, end);
  }

  rangeOf(start: number, end: number): Range {
    const from = pointAt(this.index, start, 'start');
    const to = pointAt(this.index, end, 'end');
    const range = document.createRange();
    range.setStart(from.node, from.offset);
    range.setEnd(to.node, to.offset);
    return range;
  }

  private offsetOf(container: Node, offset: number, edge: 'start' | 'end'): number {
    const node = container instanceof Text ? this.positions.get(container) : undefined;
    if (node !== undefined) return offsetInNode(this.index, node, offset, edge);
    // The point sits between nodes, in an excluded subtree, or outside the root. Find the
    // nearest indexed node in document order.
    const probe = document.createRange();
    probe.setStart(container, offset);
    const { nodes, nodeStart, nodeEnd } = this.index;
    if (edge === 'start') {
      let low = 0, high = nodes.length;
      while (low < high) {
        const mid = (low + high) >> 1;
        if (probe.comparePoint(nodes[mid]!, 0) >= 0) high = mid;
        else low = mid + 1;
      }
      return low < nodes.length ? nodeStart[low]! : this.index.length;
    }
    let low = -1, high = nodes.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if (probe.comparePoint(nodes[mid]!, nodes[mid]!.length) <= 0) low = mid;
      else high = mid - 1;
    }
    return low >= 0 ? nodeEnd[low]! : 0;
  }
}
