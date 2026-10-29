// Paints comment ranges with the CSS Custom Highlight API, which styles text without
// wrapping it in elements, so the page's own DOM and scripts are left alone. Browsers
// without the API still get the panel and scroll-to-text, only without inline tint.

export type HighlightLayers = {
  exact: Range[];
  approximate: Range[];
  active: Range | null;
  draft: Range | null;
};

const NAMES = {
  exact: 'planloft-comment',
  approximate: 'planloft-comment-approximate',
  active: 'planloft-comment-active',
  draft: 'planloft-comment-draft',
} as const;

const supported = typeof CSS !== 'undefined' && 'highlights' in CSS && typeof Highlight === 'function';

export function paintHighlights(layers: HighlightLayers): void {
  if (!supported) return;
  const set = (name: string, ranges: Range[], priority: number) => {
    if (!ranges.length) return void CSS.highlights.delete(name);
    const highlight = new Highlight(...ranges);
    highlight.priority = priority;
    CSS.highlights.set(name, highlight);
  };
  set(NAMES.exact, layers.exact, 1);
  set(NAMES.approximate, layers.approximate, 1);
  set(NAMES.active, layers.active ? [layers.active] : [], 2);
  set(NAMES.draft, layers.draft ? [layers.draft] : [], 3);
}

/** The DOM point under a viewport coordinate, for hit-testing painted ranges. */
export function pointFromCoordinates(x: number, y: number): { node: Node; offset: number } | null {
  if (typeof document.caretPositionFromPoint === 'function') {
    const position = document.caretPositionFromPoint(x, y);
    return position ? { node: position.offsetNode, offset: position.offset } : null;
  }
  if (typeof document.caretRangeFromPoint === 'function') {
    const range = document.caretRangeFromPoint(x, y);
    return range ? { node: range.startContainer, offset: range.startOffset } : null;
  }
  return null;
}
