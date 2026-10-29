import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { packageRoot } from '../core/paths.js';
import { parse, type DefaultTreeAdapterTypes } from 'parse5';
import type { CollaborationConfig } from './contracts.js';

export class CollaborationAttachmentError extends Error {
  readonly code = 'PLANLOFT_COLLABORATION_MARKERS_INVALID' as const;
  constructor() { super('Invalid collaboration markers or configuration.'); this.name = 'CollaborationAttachmentError'; }
}
export class CollaborationFramesetError extends Error {
  readonly code = 'PLANLOFT_HTML_FRAMESET_UNSUPPORTED' as const;
  constructor() { super('Frameset HTML is not supported.'); this.name = 'CollaborationFramesetError'; }
}
const safeScript = (value: string) => value.replace(/<\/script/gi, '<\\/script');
const safeJson = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
function inspectHtml(html: string) {
  const document = parse(html, { sourceCodeLocationInfo: true });
  const markers: DefaultTreeAdapterTypes.CommentNode[] = [];
  const elements: DefaultTreeAdapterTypes.Element[] = [];
  let bodyEnd: number | undefined;
  let headEnd: number | undefined;
  let htmlEnd: number | undefined;
  let bodyHasContent = false;
  let doctypeEnd = 0;
  const visit = (node: DefaultTreeAdapterTypes.Node) => {
    if ('tagName' in node) {
      elements.push(node);
      const location = node.sourceCodeLocation;
      const htmlBoundary = htmlEnd;
      const children = node.tagName === 'body' && htmlBoundary !== undefined
        ? node.childNodes.filter(child => (child.sourceCodeLocation?.startOffset ?? htmlBoundary) < htmlBoundary)
        : node.childNodes;
      const sourceEnd = location ? Math.max(location.endOffset, location.startTag?.endOffset ?? 0, children.at(-1)?.sourceCodeLocation?.endOffset ?? 0) : children.at(-1)?.sourceCodeLocation?.endOffset;
      if (node.tagName === 'frameset') throw new CollaborationFramesetError();
      if (node.tagName === 'head') headEnd = location?.endTag?.startOffset ?? sourceEnd;
      if (node.tagName === 'html') htmlEnd = node.sourceCodeLocation?.endTag?.startOffset;
      if (node.tagName === 'body') { bodyEnd = location?.endTag?.startOffset ?? sourceEnd; bodyHasContent = children.length > 0; }
      if ('content' in node) visit(node.content);
    }
    if (node.nodeName === '#documentType') doctypeEnd = node.sourceCodeLocation?.endOffset ?? 0;
    if ('data' in node && node.data.trim().startsWith('planloft-collaboration:')) markers.push(node);
    if ('childNodes' in node) for (const child of node.childNodes) visit(child);
  };
  visit(document);
  // Trailing whitespace after </html> can extend an implicit body's source span.
  const insertion = Math.min(bodyEnd ?? headEnd ?? htmlEnd ?? (bodyHasContent ? html.length : doctypeEnd), htmlEnd ?? html.length);
  const wrapHead = bodyEnd === undefined && headEnd === undefined && !bodyHasContent;
  if (!markers.length) return { insertion, wrapHead, block: null, previous: null };
  if (markers.length !== 2) throw new CollaborationAttachmentError();
  const [start, end] = markers.sort((a, b) => (a.sourceCodeLocation?.startOffset ?? 0) - (b.sourceCodeLocation?.startOffset ?? 0));
  if (!start?.sourceCodeLocation || !end?.sourceCodeLocation || start.data !== ' planloft-collaboration:start ' || end.data !== ' planloft-collaboration:end ' || start.parentNode !== end.parentNode) throw new CollaborationAttachmentError();
  if (html.slice(start.sourceCodeLocation.startOffset, start.sourceCodeLocation.endOffset) !== '<!-- planloft-collaboration:start -->' ||
      html.slice(end.sourceCodeLocation.startOffset, end.sourceCodeLocation.endOffset) !== '<!-- planloft-collaboration:end -->') throw new CollaborationAttachmentError();
  const startOffset = start.sourceCodeLocation.endOffset;
  const endOffset = end.sourceCodeLocation.startOffset;
  const owned = elements.filter(node => node.sourceCodeLocation && node.sourceCodeLocation.startOffset >= startOffset && node.sourceCodeLocation.endOffset <= endOffset)
    .sort((a, b) => a.sourceCodeLocation!.startOffset - b.sourceCodeLocation!.startOffset);
  const openings = ['<style data-planloft-collaboration>', '<script type="application/json" id="planloft-collaboration-config">', '<script data-planloft-collaboration>'];
  const closings = ['</style>', '</script>', '</script>'];
  if (owned.length !== 3) throw new CollaborationAttachmentError();
  let offset = startOffset;
  for (let i = 0; i < owned.length; i++) {
    const node = owned[i]!;
    const location = node.sourceCodeLocation;
    if (!location?.startTag || !location.endTag || node.parentNode !== start.parentNode ||
        html.slice(offset, location.startOffset) !== '\n' ||
        html.slice(location.startTag.startOffset, location.startTag.endOffset) !== openings[i] ||
        html.slice(location.endTag.startOffset, location.endTag.endOffset) !== closings[i]) throw new CollaborationAttachmentError();
    offset = location.endOffset;
  }
  if (html.slice(offset, endOffset) !== '\n') throw new CollaborationAttachmentError();
  const configLocation = owned[1]!.sourceCodeLocation!;
  let previous: unknown;
  try { previous = JSON.parse(html.slice(configLocation.startTag!.endOffset, configLocation.endTag!.startOffset)); }
  catch { throw new CollaborationAttachmentError(); }
  if (!previous || typeof previous !== 'object' || Array.isArray(previous) ||
      !('documentId' in previous) || typeof previous.documentId !== 'string' || !previous.documentId ||
      !('revision' in previous) || typeof previous.revision !== 'string' ||
      !('apiUrl' in previous) || typeof previous.apiUrl !== 'string' ||
      ('contentSelector' in previous && typeof previous.contentSelector !== 'string')) throw new CollaborationAttachmentError();
  return { insertion, wrapHead, previous, block: { start: start.sourceCodeLocation.startOffset, end: end.sourceCodeLocation.endOffset } };
}

/** Injects prebuilt assets and retains the document identity when reattaching. */
export async function attachCollaboration(html: string, config: CollaborationConfig): Promise<{ html: string; config: CollaborationConfig }> {
  const inject = prepareAttachment(html, config);
  const [client, css] = await Promise.all([
    readFile(join(packageRoot, 'dist/collaboration/client.js'), 'utf8'),
    readFile(join(packageRoot, 'dist/collaboration/client.css'), 'utf8'),
  ]);
  return inject({ client, css });
}

/** Internal assembly boundary also used by source tests without writing shared dist. */
export function attachCollaborationWithAssets(html: string, config: CollaborationConfig, assets: { client: string; css: string }): { html: string; config: CollaborationConfig } {
  return prepareAttachment(html, config)(assets);
}

function prepareAttachment(html: string, config: CollaborationConfig) {
  const { previous, insertion, wrapHead, block: existing } = inspectHtml(html);
  if (previous && typeof previous === 'object' && 'documentId' in previous && typeof previous.documentId === 'string') config = { ...config, documentId: previous.documentId };
  return (assets: { client: string; css: string }): { html: string; config: CollaborationConfig } => {
    const css = assets.css.replace(/<\/style/gi, '<\\/style');
    const block = `<!-- planloft-collaboration:start -->\n<style data-planloft-collaboration>${css}</style>\n<script type="application/json" id="planloft-collaboration-config">${safeJson(config)}</script>\n<script data-planloft-collaboration>${safeScript(assets.client)}</script>\n<!-- planloft-collaboration:end -->`;
    if (existing) return { html: html.slice(0, existing.start) + block + html.slice(existing.end), config };
    const injected = wrapHead ? `<head>${block}</head>` : `${block}\n`;
    const attached = html.slice(0, insertion) + injected + html.slice(insertion);
    if (!inspectHtml(attached).block) throw new CollaborationAttachmentError();
    return { html: attached, config };
  };
}
