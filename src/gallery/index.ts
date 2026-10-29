import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ingestDocument } from "../core/ingest.js";
import { builtinThemesDir, withPlanloftHome } from "../core/paths.js";
import { compileMdx, renderCompiledMdx } from "../mdx/index.js";
import { renderDocument } from "../render/renderer.js";
import { CATALOG, catalogDocument } from "./catalog.js";
import { HTML_SPECIMEN_BODY, HTML_SPECIMEN_DOCUMENT } from "./html-specimen.js";
import { galleryPage, type GalleryTheme } from "./page.js";
import { SPECIMEN_MDX } from "./specimen.js";

export interface GalleryOptions {
  outDir: string;
}

export interface GalleryResult {
  indexPath: string;
}

/**
 * Builds the static theme gallery: one long-form specimen, the component catalog and
 * one authored HTML page, each rendered in every bundled theme, plus an index that
 * browses them. Rendering runs against an empty Planloft home so a user's themes or
 * component registry cannot replace the built-ins being shown.
 */
export async function buildGallery({ outDir }: GalleryOptions): Promise<GalleryResult> {
  const root = path.resolve(outDir);
  const isolatedHome = fs.mkdtempSync(path.join(os.tmpdir(), "planloft-gallery-home-"));
  try {
    const themes = await withPlanloftHome(isolatedHome, () => renderPages(isolatedHome));
    for (const directory of ["specimen", "components", "html"]) fs.mkdirSync(path.join(root, directory), { recursive: true });
    for (const theme of themes) {
      fs.writeFileSync(path.join(root, theme.specimenPath), theme.specimenHtml);
      fs.writeFileSync(path.join(root, theme.componentsPath), theme.componentsHtml);
      fs.writeFileSync(path.join(root, theme.htmlPath), theme.htmlHtml);
    }
    const indexPath = path.join(root, "index.html");
    fs.writeFileSync(indexPath, galleryPage(themes, CATALOG, { specimen: SPECIMEN_MDX, html: HTML_SPECIMEN_BODY }));
    return { indexPath };
  } finally {
    fs.rmSync(isolatedHome, { recursive: true, force: true });
  }
}

interface RenderedTheme extends GalleryTheme {
  specimenHtml: string;
  componentsHtml: string;
  htmlHtml: string;
}

async function renderPages(projectRoot: string): Promise<RenderedTheme[]> {
  const names = fs
    .readdirSync(builtinThemesDir(), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(builtinThemesDir(), entry.name, "style.css")))
    .map((entry) => entry.name)
    .sort((a, b) => themeOrder(a) - themeOrder(b) || a.localeCompare(b));

  const compile = async (source: string, file: string) => {
    const sourcePath = path.join(projectRoot, file);
    const document = ingestDocument(source, { format: "mdx", trustedMdx: true, sourceName: sourcePath });
    // One compiled snapshot serves every theme; only the stylesheet changes between renders.
    return { document, code: await compileMdx(document.content, { sourcePath, projectRoot }) };
  };
  const specimen = await compile(SPECIMEN_MDX, "specimen.mdx");
  const catalog = await compile(catalogDocument(), "components.mdx");
  // The authored page goes through the same path `planloft render --format html` uses:
  // the renderer injects theme tokens, the opt-in prose sheet and the controls, and
  // leaves the authored structure, styles and script alone.
  const authored = ingestDocument(HTML_SPECIMEN_DOCUMENT, { format: "html", trustedHtml: true, sourceName: path.join(projectRoot, "survey.html") });

  const rendered: RenderedTheme[] = [];
  for (const name of names) {
    rendered.push({
      name,
      specimenPath: `specimen/${name}.html`,
      componentsPath: `components/${name}.html`,
      htmlPath: `html/${name}.html`,
      specimenHtml: await renderCompiledMdx(specimen.document, name, specimen.code, { noindex: true }),
      componentsHtml: await renderCompiledMdx(catalog.document, name, catalog.code, { noindex: true }),
      htmlHtml: renderDocument(authored, name, { noindex: true }),
    });
  }
  return rendered;
}

// Bundled themes appear from the quietest page to the loudest.
const ORDER = ["minimal", "detailed", "decision", "research", "editorial", "briefing"];
function themeOrder(name: string): number {
  const index = ORDER.indexOf(name);
  return index === -1 ? ORDER.length : index;
}
