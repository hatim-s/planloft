import fs from "node:fs";
import path from "node:path";
import pc from "picocolors";
import { loadConfig, resolveTheme } from "../core/config.js";
import { projectKey } from "../core/project.js";
import { renderDocument } from "../render/renderer.js";
import { readCanonicalDocument, type SourceFlags } from "./source.js";

export interface RenderFlags extends SourceFlags {
  out?: string;
  noindex?: boolean;
}

export async function render(input: string, flags: RenderFlags): Promise<void> {
  try {
    const doc = await readCanonicalDocument(input, flags);
    const { key } = projectKey();
    const theme = doc.theme ?? resolveTheme(loadConfig(), key);
    const html = renderDocument(doc, theme, { noindex: flags.noindex });

    if (!flags.out) {
      process.stdout.write(html);
      return;
    }

    const destination = outputFile(flags.out);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, html);
    console.log(pc.green("Rendered: ") + path.resolve(destination));
  } catch (error) {
    console.error(pc.red("Render failed: ") + (error as Error).message);
    process.exitCode = 1;
  }
}

function outputFile(output: string): string {
  return path.extname(output).toLowerCase() === ".html" ? output : path.join(output, "index.html");
}
