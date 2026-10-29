// Builds the normalized document text that anchors use, and maps each code point back
// to its source text node. Generic over the node type and free of DOM globals so Node
// tests can exercise it with plain objects.

/** A text node's data, or a block-element boundary. */
export type TextChunk<N> = { node: N; data: string } | 'break';

export interface TextIndex<N> {
  /** Normalized text. Offsets into it are Unicode code points. */
  text: string;
  /** Nodes that produced text, in document order. */
  nodes: N[];
  /** First code point each node produced, parallel to `nodes`. */
  nodeStart: number[];
  /** One past the last code point each node produced, parallel to `nodes`. */
  nodeEnd: number[];
  /** For each code point: index into `nodes`, then the UTF-16 span in that node's data. */
  owner: number[];
  from: number[];
  to: number[];
  /** Code points of `text`. */
  chars: string[];
  /** Number of code points in `text`. */
  length: number;
}

// A base character with its combining marks, so NFC composition never crosses a mapping boundary.
const CLUSTER = /\P{M}\p{M}*|\p{M}+/gu;
const WHITESPACE = /^\s+$/u;
// Invisible line-break hints that editors add and remove freely.
const DROPPED = /^[­​]$/u;

type PendingSpace<N> = { node: N; from: number; to: number } | 'break';

/**
 * Collapses whitespace runs and block boundaries to one space, drops leading and trailing
 * space, and composes characters to NFC. The result always satisfies `normalizeText(text) === text`.
 */
export function buildTextIndex<N>(chunks: Iterable<TextChunk<N>>): TextIndex<N> {
  const output: string[] = [];
  const index: TextIndex<N> = { text: '', nodes: [], nodeStart: [], nodeEnd: [], owner: [], from: [], to: [], chars: output, length: 0 };
  let pending: PendingSpace<N> | null = null;

  const nodeIndex = (node: N): number => {
    const last = index.nodes.length - 1;
    if (index.nodes[last] === node) return last;
    index.nodes.push(node);
    index.nodeStart.push(output.length);
    index.nodeEnd.push(output.length);
    return last + 1;
  };
  const push = (codePoint: string, node: number, from: number, to: number) => {
    output.push(codePoint);
    index.owner.push(node);
    index.from.push(from);
    index.to.push(to);
    index.nodeEnd[node] = output.length;
  };

  for (const chunk of chunks) {
    if (chunk === 'break') {
      pending ??= 'break';
      continue;
    }
    for (const match of chunk.data.matchAll(CLUSTER)) {
      const cluster = match[0];
      const start = match.index;
      const end = start + cluster.length;
      if (DROPPED.test(cluster)) continue;
      if (WHITESPACE.test(cluster)) {
        // Real whitespace beats a block boundary because it gives the space a source position.
        if (pending === null || pending === 'break') pending = { node: chunk.node, from: start, to: end };
        continue;
      }
      if (pending !== null && output.length > 0) {
        // A block boundary owns no source character, so it maps to a zero-width point
        // just before the character that follows it.
        if (pending === 'break') push(' ', nodeIndex(chunk.node), start, start);
        else push(' ', nodeIndex(pending.node), pending.from, pending.to);
      }
      pending = null;
      const node = nodeIndex(chunk.node);
      for (const codePoint of cluster.normalize('NFC')) push(codePoint, node, start, end);
    }
  }

  index.text = output.join('');
  index.length = output.length;
  return index;
}

/** Code-point offset for a point inside one indexed node's data. */
export function offsetInNode<N>(index: TextIndex<N>, node: number, utf16Offset: number, edge: 'start' | 'end'): number {
  const first = index.nodeStart[node]!;
  const last = index.nodeEnd[node]!;
  if (edge === 'start') {
    for (let k = first; k < last; k++) if (index.to[k]! > utf16Offset) return k;
    return last;
  }
  for (let k = last - 1; k >= first; k--) if (index.from[k]! < utf16Offset) return k + 1;
  return first;
}

/** Source position for a range boundary at a code-point offset. */
export function pointAt<N>(index: TextIndex<N>, offset: number, edge: 'start' | 'end'): { node: N; offset: number } {
  const k = edge === 'start' ? offset : offset - 1;
  const owner = index.owner[k]!;
  return { node: index.nodes[owner]!, offset: edge === 'start' ? index.from[k]! : index.to[k]! };
}

/** Shrinks a range so it neither starts nor ends on a space; null when nothing is left. */
export function trimOffsets<N>(index: TextIndex<N>, start: number, end: number): { start: number; end: number } | null {
  while (start < end && index.chars[start] === ' ') start++;
  while (end > start && index.chars[end - 1] === ' ') end--;
  return start < end ? { start, end } : null;
}
