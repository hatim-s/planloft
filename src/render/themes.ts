import { randomInt } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { builtinThemesDir, userThemesDir } from "../core/paths.js";

export type ThemeDiagnosticCode =
  | "PLANLOFT_THEME_INVALID_NAME"
  | "PLANLOFT_THEME_MISSING"
  | "PLANLOFT_THEME_INACCESSIBLE"
  | "PLANLOFT_THEME_INVALID_ASSET"
  | "PLANLOFT_THEME_LEGACY_ASSET";

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

export function randomBuiltinTheme(): string {
  const root = builtinThemesDir();
  const themes = themeDirectories(root).filter((name) =>
    name !== "random" && fs.existsSync(path.join(root, name, "style.css")),
  );
  if (themes.length === 0) {
    throw new ThemeError("PLANLOFT_THEME_MISSING", "No bundled themes are available for random selection.");
  }
  return themes[randomInt(themes.length)]!;
}

/** Reject retired authoring and layout assets before using a theme. */
export function validateTheme(theme: string): void {
  const directory = resolveThemeDirectory(theme);
  for (const asset of ["template.md", "template.mdx", "layout.html"]) {
    const file = path.join(directory, asset);
    try {
      fs.lstatSync(file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw new ThemeError("PLANLOFT_THEME_INACCESSIBLE", `Cannot inspect theme asset at ${file}.`, { cause: error });
    }
    throw new ThemeError("PLANLOFT_THEME_LEGACY_ASSET", `Legacy theme asset ${file} is no longer supported. Back it up, move authored content into a Markdown, MDX, or HTML source file, and convert theme styling to CSS variables in style.css.`);
  }
  readStyle(theme);
}

const BUNDLED_FONTS = [
  { family: "Inter", asset: "inter" },
  { family: "Raleway", asset: "raleway" },
  { family: "Geist", asset: "geist" },
  { family: "Geist Mono", asset: "geist-mono" },
];

/** Visual skin (CSS) applied by the renderer. */
export function readStyle(theme: string): string {
  const directory = resolveThemeDirectory(theme);
  const css = readOptionalThemeAsset(theme, directory, "style.css") ?? "";
  const builtinRoot = builtinThemesDir();
  if (directory !== path.join(builtinRoot, theme)) return css;

  const faces = BUNDLED_FONTS
    .filter(({ family }) => css.includes(`: "${family}",`))
    .map(({ family, asset }) => {
      const fontDir = path.join(builtinRoot, "_fonts");
      const data = readOptionalThemeAsset(theme, fontDir, `${asset}.woff2`, "base64");
      const license = readOptionalThemeAsset(theme, fontDir, `${asset}-OFL.txt`);
      if (!data || !license) throw new ThemeError("PLANLOFT_THEME_INVALID_ASSET", `Missing bundled font or license for ${family} in ${fontDir}.`);
      return `/*
${license.trim()}
*/
@font-face { font-family: "${family}"; font-style: normal; font-weight: 100 900; font-display: swap; src: url(data:font/woff2;base64,${data}) format("woff2"); }`;
    });
  return [...faces, css].join("\n");
}

function readOptionalThemeAsset(
  theme: string,
  directory: string,
  asset: string,
  encoding: BufferEncoding = "utf8",
): string | undefined {
  const file = path.join(directory, asset);
  try {
    return fs.readFileSync(file, encoding);
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
