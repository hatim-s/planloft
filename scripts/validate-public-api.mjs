import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicApi = await import(path.join(root, "dist", "index.js"));

assert.deepEqual(Object.keys(publicApi).sort(), [
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
  "renderDocument",
  "renderReadmeCliReference",
  "renderSkillDiscoveryReference",
  "sourceFormatFromPath",
]);

const application = publicApi.createPlanloftApplication({
  cwd: process.cwd(),
  planloftHome: path.join(root, ".public-api-test-home"),
});
for (const operation of [
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
]) {
  assert.equal(typeof application[operation], "function", `missing application.${operation}`);
}

for (const compatibilityExport of ["ingestDocument", "hoistDocument", "renderDocument"]) {
  assert.equal(typeof publicApi[compatibilityExport], "function");
}

const declarations = fs.readFileSync(path.join(root, "dist", "index.d.ts"), "utf8");
for (const required of [
  "interface PlanloftApplication",
  "interface ApplicationPublicationAdapter",
  "class PlanloftApplicationError",
  "declare function ingestDocument",
  "declare function hoistDocument",
  "declare function renderDocument",
]) {
  assert.match(declarations, new RegExp(required));
}
for (const privateType of ["CliAdapterOptions", "HookEvent", "HookResult", "Commander"]) {
  assert.doesNotMatch(declarations, new RegExp(privateType));
}

console.log("public API import and packed declarations: ok");
