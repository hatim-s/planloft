import fs from "node:fs";
import pc from "picocolors";
import { projectKey } from "../core/project.js";
import { removeDoc } from "../core/store.js";

export function rm(slug: string): void {
  const { key } = projectKey();
  const meta = removeDoc(key, slug);
  if (!meta) {
    console.error(pc.red(`No doc '${slug}' for this project.`));
    process.exitCode = 1;
    return;
  }
  try {
    fs.rmSync(meta.file);
  } catch {
    /* file already gone */
  }
  console.log(pc.green(`Removed ${slug}.`));
}
