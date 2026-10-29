import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { parse, type DefaultTreeAdapterTypes } from 'parse5';
import type { CollaborationConfig } from './contracts.js';

type Build = (options: Record<string, unknown>) => Promise<{ outputFiles: { text: string }[] }>;
const require = createRequire(import.meta.url);
const safeScript = (value: string) => value.replace(/<\/script/gi, '<\\/script');
const safeJson = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
function inspectHtml(html: string) {
  const document = parse(html, { sourceCodeLocationInfo: true });
  const markers: DefaultTreeAdapterTypes.CommentNode[] = [];
  const elements: DefaultTreeAdapterTypes.Element[] = [];
  let bodyEnd: number | undefined;
  const visit = (node: DefaultTreeAdapterTypes.Node) => {
    if ('tagName' in node) {
      elements.push(node);
      if (node.tagName === 'body') bodyEnd = node.sourceCodeLocation?.endTag?.startOffset;
      if ('content' in node) visit(node.content);
    }
    if ('data' in node && node.data.trim().startsWith('planloft-collaboration:')) markers.push(node);
    if ('childNodes' in node) for (const child of node.childNodes) visit(child);
  };
  visit(document);
  if (!markers.length) return { bodyEnd, block: null, previous: null };
  if (markers.length !== 2) throw new Error('Invalid collaboration markers');
  const [start, end] = markers.sort((a, b) => (a.sourceCodeLocation?.startOffset ?? 0) - (b.sourceCodeLocation?.startOffset ?? 0));
  if (!start?.sourceCodeLocation || !end?.sourceCodeLocation || start.data !== ' planloft-collaboration:start ' || end.data !== ' planloft-collaboration:end ' || start.parentNode !== end.parentNode) throw new Error('Invalid collaboration markers');
  if (html.slice(start.sourceCodeLocation.startOffset, start.sourceCodeLocation.endOffset) !== '<!-- planloft-collaboration:start -->' ||
      html.slice(end.sourceCodeLocation.startOffset, end.sourceCodeLocation.endOffset) !== '<!-- planloft-collaboration:end -->') throw new Error('Invalid collaboration markers');
  const startOffset = start.sourceCodeLocation.endOffset;
  const endOffset = end.sourceCodeLocation.startOffset;
  const owned = elements.filter(node => node.sourceCodeLocation && node.sourceCodeLocation.startOffset >= startOffset && node.sourceCodeLocation.endOffset <= endOffset)
    .sort((a, b) => a.sourceCodeLocation!.startOffset - b.sourceCodeLocation!.startOffset);
  const openings = ['<style data-planloft-collaboration>', '<script type="application/json" id="planloft-collaboration-config">', '<script data-planloft-collaboration>'];
  const closings = ['</style>', '</script>', '</script>'];
  if (owned.length !== 3) throw new Error('Invalid collaboration block');
  let offset = startOffset;
  for (let i = 0; i < owned.length; i++) {
    const node = owned[i]!;
    const location = node.sourceCodeLocation;
    if (!location?.startTag || !location.endTag || node.parentNode !== start.parentNode ||
        html.slice(offset, location.startOffset) !== '\n' ||
        html.slice(location.startTag.startOffset, location.startTag.endOffset) !== openings[i] ||
        html.slice(location.endTag.startOffset, location.endTag.endOffset) !== closings[i]) throw new Error('Invalid collaboration block');
    offset = location.endOffset;
  }
  if (html.slice(offset, endOffset) !== '\n') throw new Error('Invalid collaboration block');
  const configLocation = owned[1]!.sourceCodeLocation!;
  let previous: unknown;
  try { previous = JSON.parse(html.slice(configLocation.startTag!.endOffset, configLocation.endTag!.startOffset)); }
  catch { throw new Error('Invalid collaboration configuration'); }
  if (!previous || typeof previous !== 'object' || Array.isArray(previous) ||
      !('documentId' in previous) || typeof previous.documentId !== 'string' || !previous.documentId ||
      !('revision' in previous) || typeof previous.revision !== 'string' ||
      !('apiUrl' in previous) || typeof previous.apiUrl !== 'string' ||
      ('contentSelector' in previous && typeof previous.contentSelector !== 'string')) throw new Error('Invalid collaboration configuration');
  return { bodyEnd, previous, block: { start: start.sourceCodeLocation.startOffset, end: end.sourceCodeLocation.endOffset } };
}

/** Injects the browser bundle and retains the document identity when reattaching. */
export async function attachCollaboration(html: string, config: CollaborationConfig, options: { clientPath: string; cssPath: string }): Promise<{ html: string; config: CollaborationConfig }> {
  const { previous, bodyEnd, block: existing } = inspectHtml(html);
  if (previous && typeof previous === 'object' && 'documentId' in previous && typeof previous.documentId === 'string') config = { ...config, documentId: previous.documentId };
  const esbuild: { build: Build } = require('esbuild');
  const result = await esbuild.build({ stdin: { contents: `import { mountCollaboration } from ${JSON.stringify(options.clientPath)}; mountCollaboration(JSON.parse(document.currentScript.previousElementSibling.textContent));`, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, minify: true, write: false, format: 'iife', platform: 'browser', target: 'es2022' });
  const css = (await readFile(options.cssPath, 'utf8')).replace(/<\/style/gi, '<\\/style');
  const block = `<!-- planloft-collaboration:start -->\n<style data-planloft-collaboration>${css}</style>\n<script type="application/json" id="planloft-collaboration-config">${safeJson(config)}</script>\n<script data-planloft-collaboration>${safeScript(result.outputFiles[0]!.text)}</script>\n<!-- planloft-collaboration:end -->`;
  if (existing) return { html: html.slice(0, existing.start) + block + html.slice(existing.end), config };
  return { html: bodyEnd === undefined ? html + '\n' + block : html.slice(0, bodyEnd) + block + '\n' + html.slice(bodyEnd), config };
}
