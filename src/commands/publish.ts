import pc from "picocolors";
import { loadConfig } from "../core/config.js";
import { hoistDocument } from "../core/hoist.js";
import { calculateExpiry, resolveTtlDays } from "../core/ttl.js";
import { deploy, type DeployFlags } from "./deploy.js";
import { readCanonicalDocument, type SourceFlags } from "./source.js";

export interface PublishFlags extends SourceFlags, DeployFlags {}

/** One-step document source -> store -> themed artifact -> GitHub Pages. */
export async function publish(input: string, flags: PublishFlags): Promise<void> {
  try {
    // Publication preflight must precede source/store writes performed by hoisting.
    const cfg = loadConfig();
    const ttlDays = resolveTtlDays(flags.ttl, cfg.defaultTtlDays);
    calculateExpiry(
      ttlDays,
      new Date(),
      flags.ttl === undefined ? "config.defaultTtlDays" : "--ttl",
    );
    const doc = await readCanonicalDocument(input, flags);
    const meta = hoistDocument(doc);
    console.log(pc.green("Hoisted: ") + meta.file);
    await deploy(meta.slug, flags);
  } catch (error) {
    console.error(pc.red("Publish failed: ") + (error as Error).message);
    process.exitCode = 1;
  }
}
