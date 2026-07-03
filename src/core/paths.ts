import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Global store home (ADR-0001 §D3). Overridable for tests via PLANLOFT_HOME.
export const HOME = process.env.PLANLOFT_HOME ?? path.join(os.homedir(), ".planloft");

export const configPath = (): string => path.join(HOME, "config.json");
export const indexPath = (): string => path.join(HOME, "index.json");
export const docsDir = (): string => path.join(HOME, "docs");
export const userThemesDir = (): string => path.join(HOME, "themes");

// The built CLI lives at <pkg>/dist/cli.js; bundled assets sit beside it at <pkg>/.
const here = path.dirname(fileURLToPath(import.meta.url));
export const packageRoot = path.resolve(here, "..");

// Built-in themes shipped with the package (ADR-0001 §D18).
export const builtinThemesDir = (): string => path.join(packageRoot, "themes");
