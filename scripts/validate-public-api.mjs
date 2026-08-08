import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
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
  "renderCommandExample",
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
  "interface RedactedConfiguration",
  "interface CommandExample",
  "class PlanloftApplicationError",
  "declare function ingestDocument",
  "declare function hoistDocument",
  "declare function renderDocument",
  "declare function renderCommandExample",
]) {
  assert.match(declarations, new RegExp(required));
}
for (const privateType of [
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
]) {
  assert.doesNotMatch(declarations, new RegExp(privateType));
}

validatePackedReadmeNodeExample();

console.log("public API import, packed declarations, and README Node example: ok");

function validatePackedReadmeNodeExample() {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "planloft-readme-api-"));
  try {
    const packOutput = execFileSync(
      "npm",
      ["pack", "--json", "--ignore-scripts", "--pack-destination", temporaryRoot],
      {
        cwd: root,
        encoding: "utf8",
        env: {
          ...process.env,
          npm_config_cache: path.join(temporaryRoot, "npm-cache"),
        },
      },
    );
    const packed = JSON.parse(packOutput);
    assert.equal(packed.length, 1);
    const archive = path.join(temporaryRoot, packed[0].filename);
    execFileSync("tar", ["-xzf", archive, "-C", temporaryRoot]);

    const packageRoot = path.join(temporaryRoot, "package");
    const readme = fs.readFileSync(path.join(packageRoot, "README.md"), "utf8");
    const match = readme.match(
      /<!-- planloft:node-application-example:start -->\s*```(?:js|ts)\n([\s\S]*?)\n```\s*<!-- planloft:node-application-example:end -->/,
    );
    assert.ok(match?.[1], "packed README is missing the executable Node application example");

    const callerRoot = path.join(temporaryRoot, "caller");
    const planloftHome = path.join(temporaryRoot, "home");
    const nodeModules = path.join(temporaryRoot, "node_modules");
    fs.mkdirSync(callerRoot, { recursive: true });
    fs.mkdirSync(nodeModules, { recursive: true });
    fs.symlinkSync(packageRoot, path.join(nodeModules, "planloft"), "dir");
    const exampleFile = path.join(callerRoot, "readme-node-example.mjs");
    fs.writeFileSync(exampleFile, match[1]);

    const output = execFileSync(process.execPath, [exampleFile], {
      cwd: callerRoot,
      encoding: "utf8",
      env: { ...process.env, PLANLOFT_HOME: planloftHome },
    }).trim();
    assert.equal(typeof output, "string");
    assert.ok(output.length > 0, "README Node example did not print a resolved path");
    assert.ok(path.isAbsolute(output), `resolved path is not absolute: ${output}`);
    assert.ok(
      output.startsWith(`${planloftHome}${path.sep}`),
      `resolved path escaped the isolated Planloft home: ${output}`,
    );
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}
