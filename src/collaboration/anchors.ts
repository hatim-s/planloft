import type { TextAnchor } from './contracts.js';
export type { TextAnchor } from './contracts.js';
export type AnchorResolution = { status: 'exact' | 'approximate'; start: number; end: number } | { status: 'unattached' };
export function normalizeText(text: string): string { return text.replace(/\s+/gu, ' '); }
export function captureAnchor(text: string, start: number, end: number, context: { revision?: string; documentId?: string; contextLength?: number } = {}): TextAnchor {
  const chars = Array.from(text);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > chars.length) throw new RangeError('Invalid anchor range');
  const length = context.contextLength ?? 32;
  return { quote: chars.slice(start, end).join(''), prefix: chars.slice(Math.max(0, start - length), start).join(''), suffix: chars.slice(end, end + length).join(''), start, end, ...(context.revision === undefined ? {} : { revision: context.revision }), ...(context.documentId === undefined ? {} : { documentId: context.documentId }) };
}
export function resolveAnchor(text: string, anchor: TextAnchor): AnchorResolution {
  const chars = Array.from(text);
  const quote = Array.from(anchor.quote);
  if (!quote.length || anchor.quote.length > 4096 || !chars.length) return { status: 'unattached' };
  const prefix = Array.from(anchor.prefix);
  const suffix = Array.from(anchor.suffix);
  const starts = new Set<number>();
  const ends = new Set<number>();
  const addOccurrences = (needle: string, target: Set<number>, after: boolean) => {
    if (!needle) return;
    let at = text.indexOf(needle);
    let count = 0;
    while (at >= 0 && count++ < 100) {
      target.add(Array.from(text.slice(0, at + (after ? needle.length : 0))).length);
      at = text.indexOf(needle, at + needle.length);
    }
  };
  addOccurrences(anchor.quote, starts, false);
  addOccurrences(anchor.prefix, starts, true);
  addOccurrences(anchor.suffix, ends, false);
  // Partial context survives edits outside the selection as well.
  addOccurrences(prefix.slice(-Math.min(prefix.length, 12)).join(''), starts, true);
  addOccurrences(suffix.slice(0, Math.min(suffix.length, 12)).join(''), ends, false);
  for (let delta = -8; delta <= 8; delta++) starts.add(anchor.start + delta);
  const nearbyEnds = [...ends].sort((a, b) => Math.abs(a - anchor.end) - Math.abs(b - anchor.end)).slice(0, 12);
  for (const end of nearbyEnds) starts.add(end - quote.length);
  const candidates = [...starts].filter(start => start >= 0 && start < chars.length)
    .sort((a, b) => Math.abs(a - anchor.start) - Math.abs(b - anchor.start)).slice(0, 48);
  let best: { start: number; end: number; score: number; exact: boolean } | undefined;
  for (const start of candidates) {
    const lengths = new Set<number>([quote.length]);
    const radius = Math.max(1, Math.floor(quote.length * 0.3));
    const step = Math.max(1, Math.floor(radius / 4));
    for (let delta = -radius; delta <= radius; delta += step) lengths.add(quote.length + delta);
    for (const end of nearbyEnds) if (Math.abs(end - start - quote.length) <= radius) lengths.add(end - start);
    for (const length of lengths) {
      if (length < 1 || start + length > chars.length) continue;
      const target = chars.slice(start, start + length);
      const exact = length === quote.length && target.every((char, i) => char === quote[i]);
      // Bound edit-distance work for very long quotes by sampling at most 256 points.
      const stride = Math.max(1, Math.ceil(Math.max(quote.length, target.length) / 256));
      const a = quote.filter((_, i) => i % stride === 0);
      const b = target.filter((_, i) => i % stride === 0);
      let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
      for (let i = 0; i < a.length; i++) {
        const current = [i + 1];
        for (let j = 0; j < b.length; j++) current.push(Math.min(current[j]! + 1, previous[j + 1]! + 1, previous[j]! + Number(a[i] !== b[j])));
        previous = current;
      }
      const similarity = 1 - previous[b.length]! / Math.max(a.length, b.length);
      if (!exact && similarity < (quote.length <= 4 ? 0.5 : 0.7)) continue;
      let before = 0;
      while (before < prefix.length && before < start && prefix[prefix.length - before - 1] === chars[start - before - 1]) before++;
      let after = 0;
      while (after < suffix.length && start + length + after < chars.length && suffix[after] === chars[start + length + after]) after++;
      const contextLength = prefix.length + suffix.length;
      const context = contextLength ? (before + after) / contextLength : 0;
      if (contextLength >= 4 && context < 0.15) continue;
      const score = similarity * 0.55 + context * 0.4 + 0.05 / (1 + Math.abs(start - anchor.start) / 50);
      if (!best || score > best.score) best = { start, end: start + length, score, exact };
    }
  }
  return best ? { status: best.exact ? 'exact' : 'approximate', start: best.start, end: best.end } : { status: 'unattached' };
}
