import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { compile } from '@mdx-js/mdx';
import matter from 'gray-matter';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import { visit, SKIP } from 'unist-util-visit';
import { marked } from 'marked';
import { parseFragment } from 'parse5';

export class MigrationError extends Error {
  constructor(
    readonly code: 'UNSUPPORTED_FORMAT' | 'UNSUPPORTED_CONTENT' | 'INVALID_SOURCE' | 'PATH_CONFLICT' | 'DESTINATION_CONFLICT' | 'BACKUP_CONFLICT',
    message: string,
  ) {
    super(message);
    this.name = 'MigrationError';
  }
}

export interface MigrationOptions {
  sourcePath: string;
  destinationPath: string;
  dryRun?: boolean;
}

export interface MigrationResult {
  status: 'written' | 'unchanged' | 'dry-run' | 'dry-run-backup' | 'backup-created';
  sourcePath: string;
  destinationPath: string;
  backupPath: string;
}

async function readExisting(file: string): Promise<Buffer | null> {
  try {
    return await readFile(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

// Entities prevent Markdown and MDX syntax from changing a literal label.
function literalLabel(value: string): string {
  return value.replace(/[!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~]/g, char => `&#${char.charCodeAt(0)};`);
}

function imageLabelEnd(source: string, from: number, to: number): number {
  let depth = 1;
  for (let i = from + 2; i < to; i++) {
    if (source[i] === '\\') { i++; continue; }
    if (source[i] === '`') {
      let runEnd = i;
      while (runEnd < to && source[runEnd] === '`') runEnd++;
      const fence = source.slice(i, runEnd);
      let closing = source.indexOf(fence, runEnd);
      while (closing !== -1 && closing < to && (source[closing - 1] === '`' || source[closing + fence.length] === '`')) {
        closing = source.indexOf(fence, closing + fence.length);
      }
      if (closing !== -1 && closing < to) { i = closing + fence.length - 1; continue; }
      i = runEnd - 1;
      continue;
    }
    if (source[i] === '[') depth++;
    if (source[i] === ']' && --depth === 0) return i;
  }
  throw new MigrationError('UNSUPPORTED_CONTENT', 'Image label could not be converted safely; review it manually.');
}

function markdownImageAlt(label: string): string {
  // Marked is Planloft's Markdown renderer and preserves formatting characters in alt text.
  const html = marked.Parser.parseInline(marked.Lexer.lexInline(`![${label}](https://example.invalid)`));
  const fragment = parseFragment(html);
  const image = fragment.childNodes[0];
  if (fragment.childNodes.length !== 1 || !image || !('tagName' in image) || image.tagName !== 'img') {
    throw new MigrationError('UNSUPPORTED_CONTENT', 'Image label could not be converted safely; review it manually.');
  }
  return image.attrs.find(attr => attr.name === 'alt')?.value ?? '';
}

function convertMarkdown(raw: string): string {
  const body = matter(raw).content;
  if (!raw.endsWith(body)) throw new MigrationError('INVALID_SOURCE', 'Cannot preserve frontmatter exactly; review the document manually.');
  const prefix = raw.slice(0, raw.length - body.length);
  const tree = unified().use(remarkParse).use(remarkGfm).parse(body);
  const edits: { start: number; end: number; value: string }[] = [];
  const lineOffset = (prefix.match(/\n/g) ?? []).length;
  visit(tree, (node) => {
    if (!node.position || node.position.start.offset === undefined || node.position.end.offset === undefined) {
      throw new MigrationError('INVALID_SOURCE', 'Markdown parser did not provide a source location.');
    }
    const { start, end } = node.position;
    const from = start.offset!;
    const to = end.offset!;
    if (node.type === 'html') {
      throw new MigrationError('UNSUPPORTED_CONTENT', `Raw HTML at line ${start.line + lineOffset}, column ${start.column} needs manual conversion. Keep scripts and layout in HTML, or replace the markup with a reviewed MDX component.`);
    }
    if (node.type === 'link' && body[from] === '<' && body[to - 1] === '>') {
      const label = node.children.map(child => child.type === 'text' ? child.value : '').join('');
      const destination = node.url.replace(/([\\()])/g, '\\$1');
      edits.push({ start: from, end: to, value: `[${literalLabel(label)}](${destination})` });
      return SKIP;
    }
    if (node.type === 'image' || node.type === 'imageReference') {
      const close = imageLabelEnd(body, from, to);
      const label = body.slice(from + 2, close);
      const tail = body.slice(close + 1, to);
      // Shortcut and collapsed references use the label as their identifier.
      const reference = node.type === 'imageReference' && (node.referenceType === 'shortcut' || node.referenceType === 'collapsed')
        ? `[${label}]` : tail;
      edits.push({ start: from, end: to, value: `![${literalLabel(markdownImageAlt(label))}]${reference}` });
      return SKIP;
    }
    if (node.type === 'text') {
      const original = body.slice(from, to);
      // Preserve Markdown escapes; encode only characters MDX would interpret as syntax.
      const value = original.replace(/\\[\\`*{}\[\]()#+.!_>~-]|[{}<>]/g, match => {
        if (match.startsWith('\\')) return match;
        return ({ '{': '&#123;', '}': '&#125;', '<': '&lt;', '>': '&gt;' })[match] ?? match;
      }).replace(/(^|\r?\n)([ \t]*)(import|export)(?=\s)/g, (_, line, space, keyword: string) =>
        `${line}${space}&#${keyword.charCodeAt(0)};${keyword.slice(1)}`);
      if (value !== original) edits.push({ start: from, end: to, value });
    }
  });
  let converted = body;
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    converted = converted.slice(0, edit.start) + edit.value + converted.slice(edit.end);
  }
  return prefix + converted;
}

/** Copy HTML unchanged or conservatively convert Markdown to MDX without executing it. */
export async function migrateDocument(options: MigrationOptions): Promise<MigrationResult> {
  const sourcePath = path.resolve(options.sourcePath);
  const destinationPath = path.resolve(options.destinationPath);
  const backupPath = `${sourcePath}.bak`;
  const sourceExt = path.extname(sourcePath).toLowerCase();
  const destinationExt = path.extname(destinationPath).toLowerCase();
  if (sourcePath === destinationPath || destinationPath === backupPath) {
    throw new MigrationError('PATH_CONFLICT', 'Source, destination, and backup must be separate paths.');
  }
  const html = sourceExt === '.html' || sourceExt === '.htm';
  if (html ? destinationExt !== sourceExt : !['.md', '.markdown'].includes(sourceExt) || destinationExt !== '.mdx') {
    throw new MigrationError('UNSUPPORTED_FORMAT', 'Migration supports Markdown to .mdx or HTML to the same HTML extension only.');
  }
  const source = await readFile(sourcePath);
  let output = source;
  if (!html) {
    const raw = source.toString('utf8');
    if (!Buffer.from(raw).equals(source)) throw new MigrationError('INVALID_SOURCE', 'Markdown must be valid UTF-8.');
    const converted = convertMarkdown(raw);
    try {
      await compile(matter(converted).content, { remarkPlugins: [remarkGfm] });
    } catch (error) {
      const location = error && typeof error === 'object' && 'line' in error && 'column' in error
        && typeof error.line === 'number' && typeof error.column === 'number'
        ? ` at line ${error.line + (converted.slice(0, converted.length - matter(converted).content.length).match(/\n/g) ?? []).length}, column ${error.column}` : '';
      throw new MigrationError('UNSUPPORTED_CONTENT', `Converted Markdown cannot be parsed as MDX${location}; review the source manually.`);
    }
    output = Buffer.from(converted);
  }
  const destination = await readExisting(destinationPath);
  const backup = await readExisting(backupPath);
  if (backup && !backup.equals(source)) throw new MigrationError('BACKUP_CONFLICT', `Backup already exists with different content: ${backupPath}`);
  if (destination) {
    if (!destination.equals(output)) throw new MigrationError('DESTINATION_CONFLICT', `Destination already exists with different content: ${destinationPath}`);
    if (backup) return { status: 'unchanged', sourcePath, destinationPath, backupPath };
    if (options.dryRun) return { status: 'dry-run-backup', sourcePath, destinationPath, backupPath };
    await writeFile(backupPath, source, { flag: 'wx' });
    return { status: 'backup-created', sourcePath, destinationPath, backupPath };
  }
  if (options.dryRun) return { status: 'dry-run', sourcePath, destinationPath, backupPath };
  if (!backup) await writeFile(backupPath, source, { flag: 'wx' });
  await writeFile(destinationPath, output, { flag: 'wx' });
  return { status: 'written', sourcePath, destinationPath, backupPath };
}
