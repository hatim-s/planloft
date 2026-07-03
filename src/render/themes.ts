import fs from "node:fs";
import path from "node:path";
import { builtinThemesDir, userThemesDir } from "../core/paths.js";

/** Resolve a theme dir: a user theme (~/.planloft/themes/<name>) overrides a built-in. */
export function themeDir(theme: string): string {
  const user = path.join(userThemesDir(), theme);
  if (fs.existsSync(user)) return user;
  return path.join(builtinThemesDir(), theme);
}

/** Authoring guidance the skill injects so the agent writes in this theme's style. */
export function readTemplate(theme: string): string {
  try {
    return fs.readFileSync(path.join(themeDir(theme), "template.md"), "utf8");
  } catch {
    return "Write a clear, well-structured plan.";
  }
}

/** Visual skin (CSS) applied by the renderer. */
export function readStyle(theme: string): string {
  try {
    return fs.readFileSync(path.join(themeDir(theme), "style.css"), "utf8");
  } catch {
    return "";
  }
}
