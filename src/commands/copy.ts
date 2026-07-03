import fs from "node:fs";
import path from "node:path";
import pc from "picocolors";
import { projectKey } from "../core/project.js";
import { getDoc, latestDoc } from "../core/store.js";

/** Copy a doc's raw source into ./.planloft/plans/ in the current repo (ADR-0001 §D17). */
export function copy(slug?: string): void {
  const { key } = projectKey();
  const meta = slug ? getDoc(key, slug) : latestDoc(key);
  if (!meta) {
    console.error(pc.red("No matching doc in the store for this project."));
    process.exitCode = 1;
    return;
  }
  const destDir = path.join(process.cwd(), ".planloft", "plans");
  fs.mkdirSync(destDir, { recursive: true });
  const dest = path.join(destDir, path.basename(meta.file));
  fs.copyFileSync(meta.file, dest);
  console.log(pc.green("Copied ") + path.relative(process.cwd(), dest));
}
