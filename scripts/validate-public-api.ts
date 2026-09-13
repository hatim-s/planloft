#!/usr/bin/env bun

/**
 * Checks the built CLI version, JavaScript exports, application methods, and
 * declaration file. Package installation is tested by validate-packed-package.ts.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC_EXPORTS = [
  "APPLICATION_ERROR_CATEGORIES",
  "COMMAND_CATEGORIES",
  "COMMAND_KNOWLEDGE",
  "PlanloftApplicationError",
  "commandKnowledge",
  "createPlanloftApplication",
  "formatCommandHelp",
  "formatRootWorkflowHelp",
  "hoistDocument",
  "ingestDocument",
  "renderCommandExample",
  "renderDocument",
  "renderReadmeCliReference",
  "renderSkillDiscoveryReference",
  "sourceFormatFromPath",
] as const;
const APPLICATION_METHODS = [
  "render",
  "hoist",
  "publish",
  "resolve",
  "list",
  "preview",
  "copy",
  "deploy",
  "remove",
  "config",
  "init",
] as const;
const PUBLIC_DECLARATIONS = [
  "interface PlanloftApplication",
  "interface PlanloftApplicationErrorDetails",
  "interface ApplicationPublicationAdapter",
  "interface RedactedConfiguration",
  "interface CommandExample",
  "class PlanloftApplicationError",
  "declare function ingestDocument",
  "declare function hoistDocument",
  "declare function renderDocument",
  "declare function renderCommandExample",
] as const;
const PRIVATE_DECLARATIONS = [
  "CliAdapterOptions",
  "HookEvent",
  "HookResult",
  "HookProtocolOutput",
  "PostToolUse",
  "hookSpecificOutput",
  "__hook",
  '"hook"',
  "Commander",
  "PlanloftConfiguration",
  "DocumentPersistence",
  "PublicationModule",
  "GithubCredential",
  "HostAdapter",
  "HostAuthentication",
  "interface Manifest",
] as const;

interface PackageJson {
  version: string;
}

type PublicModule = Record<string, unknown> & {
  createPlanloftApplication: (options: { cwd: string; planloftHome: string }) => Record<string, unknown>;
};

/** Verifies the public contract emitted in dist without creating another tarball. */
async function validatePublicApi(): Promise<void> {
  const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")) as PackageJson;
  const cliVersion = execFileSync(process.execPath, [path.join(ROOT, "dist", "cli.js"), "--version"], {
    cwd: ROOT,
    encoding: "utf8",
  }).trim();
  assert.equal(cliVersion, packageJson.version);

  const publicApi = await import(path.join(ROOT, "dist", "index.js")) as PublicModule;
  assert.deepEqual(Object.keys(publicApi).sort(), [...PUBLIC_EXPORTS].sort());

  const application = publicApi.createPlanloftApplication({
    cwd: ROOT,
    planloftHome: path.join(ROOT, ".public-api-test-home"),
  });
  for (const method of APPLICATION_METHODS) {
    assert.equal(typeof application[method], "function", `missing application.${method}`);
  }

  const declarations = fs.readFileSync(path.join(ROOT, "dist", "index.d.ts"), "utf8");
  for (const declaration of PUBLIC_DECLARATIONS) assert.match(declarations, new RegExp(declaration));
  for (const declaration of PRIVATE_DECLARATIONS) assert.doesNotMatch(declarations, new RegExp(declaration));

  console.log("public API: version, exports, methods, and declarations PASS");
}

await validatePublicApi();
