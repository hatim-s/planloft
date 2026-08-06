import pc from "picocolors";
import { hoistDocument } from "../core/hoist.js";
import { readCanonicalDocument, type SourceFlags } from "./source.js";

export async function hoist(input: string, flags: SourceFlags): Promise<void> {
  try {
    const doc = await readCanonicalDocument(input, flags);
    const meta = hoistDocument(doc);
    console.log(pc.green("Hoisted: ") + meta.file);
    console.log(JSON.stringify({ slug: meta.slug, kind: meta.kind, format: meta.format }));
  } catch (error) {
    console.error(pc.red("Hoist failed: ") + (error as Error).message);
    process.exitCode = 1;
  }
}
