import pc from "picocolors";
import { hoistDocument } from "../core/hoist.js";
import { deploy, type DeployFlags } from "./deploy.js";
import { readCanonicalDocument, type SourceFlags } from "./source.js";

export interface PublishFlags extends SourceFlags, DeployFlags {}

/** One-step document source -> store -> themed artifact -> GitHub Pages. */
export async function publish(input: string, flags: PublishFlags): Promise<void> {
  try {
    const doc = await readCanonicalDocument(input, flags);
    const meta = hoistDocument(doc);
    console.log(pc.green("Hoisted: ") + meta.file);
    await deploy(meta.slug, flags);
  } catch (error) {
    console.error(pc.red("Publish failed: ") + (error as Error).message);
    process.exitCode = 1;
  }
}
