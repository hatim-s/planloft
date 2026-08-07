import fs from "node:fs";
import path from "node:path";
import pc from "picocolors";
import { gitRoot, projectKey } from "../core/project.js";
import { getDoc, latestDoc } from "../core/store.js";

export interface CopyOptions {
  cwd?: string;
  force?: boolean;
}

/** Copy a doc's exact raw source into <git-root>/.planloft/plans/ (ADR-0001 §D17). */
export function copy(slug?: string, options: CopyOptions = {}): void {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const { key } = projectKey(cwd);
  const meta = slug ? getDoc(key, slug) : latestDoc(key);
  if (!meta) {
    console.error(pc.red("No matching doc in the store for this project."));
    process.exitCode = 1;
    return;
  }
  const root = gitRoot(cwd);
  if (!root) {
    console.log(pc.yellow("Not in a Git repository; using the current directory as the copy root."));
  }
  const destDir = path.join(root ?? cwd, ".planloft", "plans");
  fs.mkdirSync(destDir, { recursive: true });
  const dest = path.join(destDir, path.basename(meta.file));
  if (fs.existsSync(dest) && !options.force) {
    console.error(pc.red(`Refusing to overwrite ${dest}. Re-run with --force to replace it.`));
    process.exitCode = 1;
    return;
  }
  fs.copyFileSync(meta.file, dest);
  console.log(pc.green("Copied ") + path.relative(root ?? cwd, dest));
}
