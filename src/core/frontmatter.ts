import matter from "gray-matter";

export interface Frontmatter {
  title?: string;
  slug?: string;
  kind?: string;
  theme?: string;
  status?: string;
  [key: string]: unknown;
}

export function parse(raw: string): { data: Frontmatter; content: string } {
  const g = matter(raw);
  return { data: g.data as Frontmatter, content: g.content };
}

export function stringify(content: string, data: Frontmatter): string {
  return matter.stringify(content, data);
}
