import pc from "picocolors";
import { loadIndex } from "../core/store.js";

/** List docs grouped by project, optionally filtered by kind (ADR-0002). */
export function list(opts: { kind?: string } = {}): void {
  const projects = Object.values(loadIndex().projects);
  if (projects.length === 0) {
    console.log(pc.dim("No docs yet. Produce a plan/adr/research doc and planloft captures it."));
    return;
  }
  for (const p of projects) {
    let docs = Object.values(p.docs).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    if (opts.kind) docs = docs.filter((d) => d.kind === opts.kind);
    if (docs.length === 0) continue;

    console.log(pc.bold(p.label) + pc.dim(`  (${p.key})`));
    for (const d of docs) {
      const kind = pc.magenta(`[${d.kind}]`.padEnd(11));
      console.log(`  ${kind} ${pc.cyan(d.slug.padEnd(24))} ${pc.dim(d.format.padEnd(5))} ${d.title}`);
    }
  }
}
