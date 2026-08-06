import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Global store home (ADR-0001 §D3). Read lazily so tests and library callers can set
// PLANLOFT_HOME before an operation without having to control module import order.
export const planloftHome = (): string =>
  process.env.PLANLOFT_HOME ?? path.join(os.homedir(), ".planloft");

export const configPath = (): string => path.join(planloftHome(), "config.json");
export const indexPath = (): string => path.join(planloftHome(), "index.json");
export const docsDir = (): string => path.join(planloftHome(), "docs");
export const userThemesDir = (): string => path.join(planloftHome(), "themes");

// The built CLI lives at <pkg>/dist/cli.js; bundled assets sit beside it at <pkg>/.
const here = path.dirname(fileURLToPath(import.meta.url));
const runtimeRoot = path.resolve(here, "..");
export const packageRoot = path.basename(runtimeRoot) === "src" ? path.dirname(runtimeRoot) : runtimeRoot;

// Built-in themes shipped with the package (ADR-0001 §D18).
export const builtinThemesDir = (): string => path.join(packageRoot, "themes");

// Bundled deploy templates (prune Action, prune.mjs) — ADR-0001 §D15.
export const templatesDir = (): string => path.join(packageRoot, "templates");

// Local working clones of host repos (e.g. ~/.planloft/hosting/planloft-plans) — ADR-0001 §D15.
export const hostingDir = (): string => path.join(planloftHome(), "hosting");
