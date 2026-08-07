import fs from "node:fs";
import path from "node:path";
import { builtinThemesDir, userThemesDir } from "../core/paths.js";

export type ThemeDiagnosticCode =
  | "PLANLOFT_THEME_INVALID_NAME"
  | "PLANLOFT_THEME_MISSING"
  | "PLANLOFT_THEME_INACCESSIBLE"
  | "PLANLOFT_THEME_INVALID_ASSET"
  | "PLANLOFT_THEME_INVALID_LAYOUT";

export class ThemeError extends Error {
  constructor(
    readonly code: ThemeDiagnosticCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(`[${code}] ${message}`, options);
    this.name = "ThemeError";
  }
}

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
  return resolveThemeDirectory(theme);
}

export function assertThemeName(theme: string): void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(theme)) {
    throw new ThemeError(
      "PLANLOFT_THEME_INVALID_NAME",
      `Invalid theme name ${JSON.stringify(theme)}. Use letters, numbers, dots, underscores, and hyphens.`,
    );
  }
}

export function resolveThemeDirectory(theme: string): string {
  assertThemeName(theme);
  const user = path.join(userThemesDir(), theme);
  const userState = directoryState(user, theme);
  if (userState === "directory") return user;
  if (userState === "not-directory") {
    throw new ThemeError(
      "PLANLOFT_THEME_INVALID_ASSET",
      `Theme ${JSON.stringify(theme)} must be a directory, but ${user} is not.`,
    );
  }

  const builtin = path.join(builtinThemesDir(), theme);
  const builtinState = directoryState(builtin, theme);
  if (builtinState === "directory") return builtin;
  if (builtinState === "not-directory") {
    throw new ThemeError(
      "PLANLOFT_THEME_INVALID_ASSET",
      `Theme ${JSON.stringify(theme)} must be a directory, but ${builtin} is not.`,
    );
  }

  throw new ThemeError(
    "PLANLOFT_THEME_MISSING",
    `Theme ${JSON.stringify(theme)} does not exist. Available themes: ${formatAvailableThemes()}.`,
  );
}

export function listAvailableThemes(): string[] {
  return [...new Set([...themeDirectories(builtinThemesDir()), ...themeDirectories(userThemesDir())])].sort();
}

/** Validate the complete optional-asset contract for a real theme. */
export function validateTheme(theme: string): void {
  readTemplate(theme);
  readStyle(theme);
  readLayout(theme);
}

/** Constrained HTML layout. Existing themes without one use the compatible default. */
export function readLayout(theme: string): string {
  const layout = readOptionalThemeAsset(theme, "layout.html");
  return layout === undefined ? DEFAULT_LAYOUT : validateLayout(layout, theme);
}

function validateLayout(layout: string, theme: string): string {
  if (!layout.includes("{{body}}")) {
    throw new ThemeError(
      "PLANLOFT_THEME_INVALID_LAYOUT",
      `Theme ${JSON.stringify(theme)} layout.html must contain {{body}}.`,
    );
  }
  const allowed = new Set(["title", "kind", "body", "styles", "robots", "comments"]);
  const slots = [...layout.matchAll(/\{\{([^{}]*)\}\}/g)];
  const unknown = slots
    .map((match) => match[1])
    .filter((slot): slot is string => !!slot && !allowed.has(slot));
  if (unknown.length) {
    throw new ThemeError(
      "PLANLOFT_THEME_INVALID_LAYOUT",
      `Theme ${JSON.stringify(theme)} layout.html uses unknown slot: {{${unknown[0]}}}.`,
    );
  }
  const withoutSlots = layout.replace(/\{\{[^{}]*\}\}/g, "");
  if (slots.some((match) => match[1] === "") || withoutSlots.includes("{{") || withoutSlots.includes("}}")) {
    throw new ThemeError(
      "PLANLOFT_THEME_INVALID_LAYOUT",
      `Theme ${JSON.stringify(theme)} layout.html contains malformed slot syntax.`,
    );
  }
  return layout;
}

/** Authoring guidance the skill injects so the agent writes in this theme's style. */
export function readTemplate(theme: string): string {
  return readOptionalThemeAsset(theme, "template.md") ?? "Write a clear, well-structured plan.";
}

/** Visual skin (CSS) applied by the renderer. */
export function readStyle(theme: string): string {
  return readOptionalThemeAsset(theme, "style.css") ?? "";
}

function readOptionalThemeAsset(theme: string, asset: string): string | undefined {
  const directory = resolveThemeDirectory(theme);
  const file = path.join(directory, asset);
  try {
    return fs.readFileSync(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      try {
        fs.lstatSync(file);
      } catch (inspectionError) {
        if ((inspectionError as NodeJS.ErrnoException).code !== "ENOENT") {
          throw new ThemeError(
            "PLANLOFT_THEME_INACCESSIBLE",
            `Cannot inspect ${asset} for theme ${JSON.stringify(theme)} at ${file}.`,
            { cause: inspectionError },
          );
        }
        // An absent optional asset gets its documented default, but a concurrently
        // removed theme is still reported as a missing theme.
        resolveThemeDirectory(theme);
        return undefined;
      }
      throw new ThemeError(
        "PLANLOFT_THEME_INACCESSIBLE",
        `Cannot read ${asset} for theme ${JSON.stringify(theme)} at ${file}.`,
        { cause: error },
      );
    }
    throw new ThemeError(
      "PLANLOFT_THEME_INACCESSIBLE",
      `Cannot read ${asset} for theme ${JSON.stringify(theme)} at ${file}.`,
      { cause: error },
    );
  }
}

function directoryState(
  directory: string,
  theme: string,
): "directory" | "missing" | "not-directory" {
  try {
    return fs.statSync(directory).isDirectory() ? "directory" : "not-directory";
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      try {
        fs.lstatSync(directory);
      } catch (inspectionError) {
        if ((inspectionError as NodeJS.ErrnoException).code === "ENOENT") return "missing";
        throw new ThemeError(
          "PLANLOFT_THEME_INACCESSIBLE",
          `Cannot inspect theme ${JSON.stringify(theme)} at ${directory}.`,
          { cause: inspectionError },
        );
      }
    }
    throw new ThemeError(
      "PLANLOFT_THEME_INACCESSIBLE",
      `Cannot inspect theme ${JSON.stringify(theme)} at ${directory}.`,
      { cause: error },
    );
  }
}

function themeDirectories(root: string): string[] {
  let names: string[];
  try {
    names = fs.readdirSync(root);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw new ThemeError(
      "PLANLOFT_THEME_INACCESSIBLE",
      `Cannot list theme directory ${root}.`,
      { cause: error },
    );
  }
  return names.filter((name) => {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name)) return false;
    try {
      return fs.statSync(path.join(root, name)).isDirectory();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        try {
          fs.lstatSync(path.join(root, name));
        } catch (inspectionError) {
          if ((inspectionError as NodeJS.ErrnoException).code === "ENOENT") return false;
          throw new ThemeError(
            "PLANLOFT_THEME_INACCESSIBLE",
            `Cannot inspect theme ${JSON.stringify(name)} at ${path.join(root, name)}.`,
            { cause: inspectionError },
          );
        }
      }
      throw new ThemeError(
        "PLANLOFT_THEME_INACCESSIBLE",
        `Cannot inspect theme ${JSON.stringify(name)} at ${path.join(root, name)}.`,
        { cause: error },
      );
    }
  });
}

function formatAvailableThemes(): string {
  const themes = listAvailableThemes();
  return themes.length ? themes.join(", ") : "(none)";
}
