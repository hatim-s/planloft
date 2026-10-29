import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { evaluate } from '@mdx-js/mdx';
import remarkGfm from 'remark-gfm';
import * as jsxRuntime from 'react/jsx-runtime';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import matter from 'gray-matter';
import { marked } from 'marked';
import { parseFragment, defaultTreeAdapter as adapter } from 'parse5';
import type { DefaultTreeAdapterTypes } from 'parse5';
import { MigrationError, migrateDocument } from '../src/migration/index.js';

async function fixture(run: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(path.join(tmpdir(), 'planloft-migration-'));
  try { await run(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}

test('migrates Markdown prose, code and GFM while preserving rendered meaning', () => fixture(async dir => {
  const sourcePath = path.join(dir, 'source.md');
  const destinationPath = path.join(dir, 'source.mdx');
  const source = [
    '---', 'title: Example', 'custom: value', '---', '',
    '# Plan', '', 'import records {x} and 1 < 2 > 0.', '',
    'export data for [readers](https://example.com). Visit https://example.org and <https://example.net>.', '',
    'Inline `const x = {a: "<tag>"}`.', '', '```js', 'const x = {a: "<tag>"}', '```', '',
    '| Name | Status |', '| --- | --- |', '| {task} | ~~old~~ |', '', '- [ ] Pending', '- [x] Done', '',
  ].join('\n');
  await writeFile(sourcePath, source);
  assert.equal((await migrateDocument({ sourcePath, destinationPath, dryRun: true })).status, 'dry-run');
  await assert.rejects(readFile(destinationPath), { code: 'ENOENT' });
  await assert.rejects(readFile(`${sourcePath}.bak`), { code: 'ENOENT' });
  assert.equal((await migrateDocument({ sourcePath, destinationPath })).status, 'written');
  const converted = await readFile(destinationPath, 'utf8');
  assert.deepEqual(matter(converted).data, matter(source).data);
  assert.match(converted, /```js\nconst x = \{a: "<tag>"\}\n```/);
  assert.equal(await readFile(`${sourcePath}.bak`, 'utf8'), source);
  const { default: Component } = await evaluate(matter(converted).content, { ...jsxRuntime, remarkPlugins: [remarkGfm] });
  const html = renderToStaticMarkup(createElement(Component));
  for (const part of ['import records {x} and 1 &lt; 2 &gt; 0.', 'export data for', 'href="https://example.com"', 'href="https://example.org"', 'href="https://example.net"', '<table>', '{task}', '<del>old</del>', 'type="checkbox"', 'checked=""', 'const x = {a: &quot;&lt;tag&gt;&quot;}']) {
    assert.ok(html.includes(part), `Missing ${part} in ${html}`);
  }
  assert.equal((await migrateDocument({ sourcePath, destinationPath })).status, 'unchanged');
  await writeFile(`${sourcePath}.bak`, 'unrelated');
  for (const dryRun of [true, false]) {
    await assert.rejects(migrateDocument({ sourcePath, destinationPath, dryRun }), /Backup already exists with different content/);
  }
}));

test('rejects raw HTML with its original location and protects existing files', () => fixture(async dir => {
  const sourcePath = path.join(dir, 'source.md');
  const destinationPath = path.join(dir, 'source.mdx');
  await writeFile(sourcePath, '---\ntitle: X\n---\n\n    {process.version}\n\nText\n\n<script>alert(1)</script>\n');
  await assert.rejects(migrateDocument({ sourcePath, destinationPath }), /Raw HTML at line 9, column 1.*Keep scripts and layout in HTML/);
  await assert.rejects(readFile(destinationPath), { code: 'ENOENT' });
  await assert.rejects(readFile(`${sourcePath}.bak`), { code: 'ENOENT' });
  await writeFile(sourcePath, '# Safe');
  await writeFile(destinationPath, 'unrelated');
  await assert.rejects(migrateDocument({ sourcePath, destinationPath }), /Destination already exists/);
  assert.equal(await readFile(destinationPath, 'utf8'), 'unrelated');
  await rm(destinationPath);
  await writeFile(`${sourcePath}.bak`, 'older data');
  await assert.rejects(migrateDocument({ sourcePath, destinationPath }), /Backup already exists/);
  assert.equal(await readFile(`${sourcePath}.bak`, 'utf8'), 'older data');
}));

test('indented code stays inert and retains Markdown block structure when rendered as MDX', () => fixture(async dir => {
  const examples = [
    '    {process.version}\n',
    '    <aside>literal</aside>\n',
    '    const value = 42;\n',
    'Before\n\n    {(() => { throw new Error("example executed") })()}\n\nAfter\n',
    '    first\n\n        nested indentation\n    last  \n',
    '    ````````\n    {process.version}\n    ~~~\n    ```\n',
    '- item\n\n      {process.version}\n      <aside>literal</aside>\n\n  After\n\n- next\n',
    '-     {process.version}\n      next line\n',
    '12. item\n\n        {process.version}\n\n    After\n',
    '- outer\n  - inner\n\n        {process.version}\n\n    After\n',
    '> Before\n>\n>     {process.version}\n>     <aside>literal</aside>\n>\n> After\n',
    '>     code with trailing spaces  \n',
    '- > Before\n  >\n  >     {process.version}\n  >\n  > After\n',
    '> - item\n>\n>       {process.version}\n>       next line\n>\n>   After\n',
    '```js\n{process.version}\n```\n\n    <aside>literal</aside>\n\nAfter\n',
    '\t{process.version}\n',
    '---\r\ntitle: Example\r\n---\r\n\r\nBefore\r\n\r\n    {process.version}\r\n\r\nAfter\r\n',
  ];
  type Node = DefaultTreeAdapterTypes.Node;
  function structure(node: Node, code = false): unknown {
    if (adapter.isTextNode(node)) {
      const value = adapter.getTextNodeContent(node);
      return code ? value : value.replace(/\s+/g, ' ').trim() || null;
    }
    const tag = adapter.isElementNode(node) ? adapter.getTagName(node) : 'fragment';
    const children = 'childNodes' in node
      ? adapter.getChildNodes(node).map(child => structure(child, code || tag === 'pre')).filter(child => child !== null)
      : [];
    return [tag, adapter.isElementNode(node) ? adapter.getAttrList(node) : [], children];
  }
  for (const [index, source] of examples.entries()) {
    const sourcePath = path.join(dir, `${index}.md`);
    const destinationPath = path.join(dir, `${index}.mdx`);
    await writeFile(sourcePath, source);
    assert.equal((await migrateDocument({ sourcePath, destinationPath, dryRun: true })).status, 'dry-run');
    await assert.rejects(readFile(destinationPath), { code: 'ENOENT' });
    await assert.rejects(readFile(`${sourcePath}.bak`), { code: 'ENOENT' });
    await migrateDocument({ sourcePath, destinationPath });
    const converted = await readFile(destinationPath, 'utf8');
    const { default: Component } = await evaluate(matter(converted).content, { ...jsxRuntime, remarkPlugins: [remarkGfm] });
    const mdx = renderToStaticMarkup(createElement(Component));
    const markdown = await marked.parse(matter(source).content, { async: false });
    assert.deepEqual(structure(parseFragment(mdx)), structure(parseFragment(markdown)), `Changed example ${index}: ${source}`);
    assert.equal(await readFile(sourcePath, 'utf8'), source);
    assert.equal(await readFile(`${sourcePath}.bak`, 'utf8'), source);
    assert.equal((await migrateDocument({ sourcePath, destinationPath })).status, 'unchanged');
  }
}));

test('ambiguous indented code is rejected with its source location before any writes', () => fixture(async dir => {
  const sourcePath = path.join(dir, 'source.md');
  const destinationPath = path.join(dir, 'source.mdx');
  for (const [body, message] of [
    ['>\t    {process.version}\n', /line 5, column 3.*container indentation cannot be preserved safely/],
    ['\t{process.version}\n\t\tstill code\n', /line 5, column 1.*tab characters inside code render differently/],
    ['-     x  \n', /line 5, column 3.*trailing whitespace inside list code/],
    ['-     x\n      \n      ', /line 5, column 3.*trailing whitespace inside list code/],
    ['- item\n\n      x  \n', /line 7, column 3.*trailing whitespace inside list code/],
    ['> -     x  \n', /line 5, column 5.*trailing whitespace inside list code/],
  ] as const) {
    const source = `---\ntitle: Example\n---\n\n${body}`;
    await writeFile(sourcePath, source);
    for (const dryRun of [true, false]) {
      await assert.rejects(migrateDocument({ sourcePath, destinationPath, dryRun }), error => {
        assert.ok(error instanceof MigrationError);
        assert.equal(error.code, 'UNSUPPORTED_CONTENT');
        assert.match(error.message, message);
        return true;
      });
      assert.equal(await readFile(sourcePath, 'utf8'), source);
      await assert.rejects(readFile(destinationPath), { code: 'ENOENT' });
      await assert.rejects(readFile(`${sourcePath}.bak`), { code: 'ENOENT' });
    }
  }
}));

test('HTML including scripts remains byte-identical and is never converted', () => fixture(async dir => {
  const sourcePath = path.join(dir, 'page.html');
  const destinationPath = path.join(dir, 'copy.html');
  const html = '<html><body><script>call({x: 1})</script></body></html>';
  await writeFile(sourcePath, html);
  await migrateDocument({ sourcePath, destinationPath });
  assert.equal(await readFile(destinationPath, 'utf8'), html);
  await assert.rejects(migrateDocument({ sourcePath, destinationPath: path.join(dir, 'page.mdx') }), /supports Markdown/);
}));

test('image alternative text and autolink labels match Markdown rendering', () => fixture(async dir => {
  const sourcePath = path.join(dir, 'images.md');
  const destinationPath = path.join(dir, 'images.mdx');
  const source = [
    '![a {b}](https://example.org/x)',
    '![a *b* and `code`](https://example.org/y "title")',
    '![`a]b` and `x[y`](https://example.org/z)',
    '![![nested](x)](https://example.org/nested)',
    '![escaped \\[brackets\\] &amp; {brace}][photo]',
    '![shortcut {x}]',
    '![collapsed {x}][]',
    '', '[photo]: https://example.org/ref', '[shortcut {x}]: https://example.org/short',
    '[collapsed {x}]: https://example.org/collapsed', '',
    '<https://example.org/a*b*c>', '<https://example.org/a_b_c>', '<user@example.org>', '',
  ].join('\n');
  await writeFile(sourcePath, source);
  await migrateDocument({ sourcePath, destinationPath });
  const converted = await readFile(destinationPath, 'utf8');
  const { default: Component } = await evaluate(converted, { ...jsxRuntime, remarkPlugins: [remarkGfm] });
  const markdown = parseFragment(await marked.parse(source, { async: false }));
  const mdx = parseFragment(renderToStaticMarkup(createElement(Component)));
  type Node = DefaultTreeAdapterTypes.Node;
  function collect(root: Node) {
    const result: { tag: string; value: string; href: string }[] = [];
    function text(node: Node): string {
      if (adapter.isTextNode(node)) return adapter.getTextNodeContent(node);
      return 'childNodes' in node ? adapter.getChildNodes(node).map(text).join('') : '';
    }
    function walk(node: Node) {
      if (adapter.isElementNode(node) && ['img', 'a'].includes(adapter.getTagName(node))) {
        const tag = adapter.getTagName(node);
        const attrs = adapter.getAttrList(node);
        result.push({ tag, value: tag === 'img' ? attrs.find(attr => attr.name === 'alt')?.value ?? '' : text(node), href: attrs.find(attr => attr.name === (tag === 'img' ? 'src' : 'href'))?.value ?? '' });
      }
      if ('childNodes' in node) adapter.getChildNodes(node).forEach(walk);
    }
    walk(root);
    return result;
  }
  assert.deepEqual(collect(mdx), collect(markdown));
}));

test('an existing destination requires a backup and dry run reports the plan', () => fixture(async dir => {
  const sourcePath = path.join(dir, 'same.md');
  const destinationPath = path.join(dir, 'same.mdx');
  const source = '# Hello\n';
  await writeFile(sourcePath, source);
  await writeFile(destinationPath, source);
  assert.equal((await migrateDocument({ sourcePath, destinationPath, dryRun: true })).status, 'dry-run-backup');
  await assert.rejects(readFile(`${sourcePath}.bak`), { code: 'ENOENT' });
  assert.equal((await migrateDocument({ sourcePath, destinationPath })).status, 'backup-created');
  assert.equal(await readFile(`${sourcePath}.bak`, 'utf8'), source);
  assert.equal(await readFile(destinationPath, 'utf8'), source);
  assert.equal((await migrateDocument({ sourcePath, destinationPath, dryRun: true })).status, 'unchanged');
  assert.equal((await migrateDocument({ sourcePath, destinationPath })).status, 'unchanged');
  await writeFile(`${sourcePath}.bak`, 'different');
  for (const dryRun of [true, false]) {
    await assert.rejects(migrateDocument({ sourcePath, destinationPath, dryRun }), /Backup already exists with different content/);
  }
}));
