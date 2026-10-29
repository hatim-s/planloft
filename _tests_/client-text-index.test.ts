import { test } from 'node:test';
import assert from 'node:assert/strict';
import { captureAnchor, normalizeText, resolveAnchor } from '../src/collaboration/anchors.js';
import { buildTextIndex, offsetInNode, pointAt, trimOffsets, type TextChunk } from '../src/collaboration/ui/text-index.js';

// Plain objects stand in for DOM text nodes; the index only compares them by identity.
type FakeNode = { name: string };
const node = (name: string): FakeNode => ({ name });
const chunk = (target: FakeNode, data: string): TextChunk<FakeNode> => ({ node: target, data });

test('index text matches anchor normalization across blocks, inline nodes and whitespace', () => {
  const [heading, bold, rest, item] = [node('h'), node('b'), node('p'), node('li')];
  const index = buildTextIndex([
    'break', chunk(heading, '  Plan\n'), 'break',
    'break', chunk(bold, 'Ship'), chunk(rest, ' it  \t now.'), 'break',
    'break', chunk(item, 'co­operate​'), 'break',
  ]);
  assert.equal(index.text, 'Plan Ship it now. cooperate');
  assert.equal(normalizeText(index.text), index.text);
  // Inline formatting does not split words: "Ship" and " it" are separate nodes.
  assert.deepEqual(pointAt(index, 5, 'start'), { node: bold, offset: 0 });
  assert.deepEqual(pointAt(index, 12, 'end'), { node: rest, offset: 3 });
});

test('offsets count code points and composed characters, and map back to UTF-16 positions', () => {
  const text = node('t');
  // An astral emoji is two UTF-16 units; "e" + combining acute composes to one code point.
  const index = buildTextIndex([chunk(text, 'a😀 café b')]);
  assert.equal(index.text, 'a😀 café b');
  assert.equal(index.length, 9);
  assert.deepEqual(pointAt(index, 2, 'start'), { node: text, offset: 3 });
  // The composed "é" covers both source units, so a range ending after it ends after the mark.
  assert.deepEqual(pointAt(index, 7, 'end'), { node: text, offset: 9 });
  assert.equal(offsetInNode(index, 0, 9, 'end'), 7);
});

test('every code-point boundary survives the round trip through source positions', () => {
  const nodes = [node('a'), node('b'), node('c')];
  const index = buildTextIndex([
    chunk(nodes[0]!, 'One  😀 two'), 'break', chunk(nodes[1]!, '\n  thrée'), chunk(nodes[2]!, ' four  '),
  ]);
  for (let offset = 0; offset < index.length; offset++) {
    const start = pointAt(index, offset, 'start');
    assert.equal(offsetInNode(index, nodes.indexOf(start.node), start.offset, 'start'), offset, `start ${offset}`);
    const end = pointAt(index, offset + 1, 'end');
    assert.equal(offsetInNode(index, nodes.indexOf(end.node), end.offset, 'end'), offset + 1, `end ${offset + 1}`);
  }
});

test('selection edges on collapsed whitespace never put a space at either end of the quote', () => {
  const text = node('t');
  const index = buildTextIndex([chunk(text, 'alpha   beta')]);
  assert.equal(index.text, 'alpha beta');
  // Selecting "beta" from inside the whitespace run starts at "b".
  assert.equal(offsetInNode(index, 0, 6, 'start'), 6);
  // Ending inside the run covers the collapsed space, which capture then trims off.
  const end = offsetInNode(index, 0, 7, 'end');
  assert.deepEqual(trimOffsets(index, 0, end), { start: 0, end: 5 });
  assert.deepEqual(trimOffsets(index, 5, 10), { start: 6, end: 10 });
  assert.equal(trimOffsets(index, 5, 6), null);
});

test('anchors captured from the index re-resolve after inline markup changes', () => {
  const before = buildTextIndex([chunk(node('p'), 'Keep the launch date on 4 May.')]);
  const anchor = captureAnchor(before.text, 9, 20, { revision: '1', documentId: 'doc' });
  assert.equal(anchor.quote, 'launch date');
  // The same words split across new inline elements and wrapped in extra whitespace.
  const after = buildTextIndex([
    'break', chunk(node('p1'), 'Note: keep the '), chunk(node('em'), 'launch'), chunk(node('p2'), '\n date on 4 May.'), 'break',
  ]);
  assert.deepEqual(resolveAnchor(after.text, anchor), { status: 'exact', start: 15, end: 26 });
});
