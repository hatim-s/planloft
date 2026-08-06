import fs from "node:fs";
import path from "node:path";
import { builtinThemesDir, userThemesDir } from "../core/paths.js";

export const DEFAULT_LAYOUT = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />{{robots}}
<title>{{title}}</title>
<style>{{styles}}</style>
</head>
<body data-planloft-kind="{{kind}}">
<main class="planloft-plan">
<article>{{body}}</article>{{comments}}
</main>
</body>
</html>
`;

/** Resolve a theme dir: a user theme (~/.planloft/themes/<name>) overrides a built-in. */
export function themeDir(theme: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(theme)) {
    throw new Error(`Invalid theme name: ${theme}`);
  }
  const user = path.join(userThemesDir(), theme);
  if (fs.existsSync(user)) return user;
  return path.join(builtinThemesDir(), theme);
}

/** Constrained HTML layout. Existing themes without one use the compatible default. */
export function readLayout(theme: string): string {
  try {
    return validateLayout(fs.readFileSync(path.join(themeDir(theme), "layout.html"), "utf8"), theme);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return DEFAULT_LAYOUT;
    throw error;
  }
}

function validateLayout(layout: string, theme: string): string {
  if (!layout.includes("{{body}}")) {
    throw new Error(`Theme ${theme} layout.html must contain {{body}}.`);
  }
  const allowed = new Set(["title", "kind", "body", "styles", "robots", "comments"]);
  const unknown = [...layout.matchAll(/\{\{([a-zA-Z0-9_-]+)\}\}/g)]
    .map((match) => match[1])
    .filter((slot): slot is string => !!slot && !allowed.has(slot));
  if (unknown.length) {
    throw new Error(`Theme ${theme} layout.html uses unknown slot: {{${unknown[0]}}}.`);
  }
  return layout;
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
