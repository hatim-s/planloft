import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXPECTED_RELEASE_VERSION = "0.2.1";
const builtCliVersion = execFileSync(
  process.execPath,
  [path.join(root, "dist", "cli.js"), "--version"],
  { cwd: root, encoding: "utf8" },
).trim();
assert.equal(builtCliVersion, EXPECTED_RELEASE_VERSION);
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
  "interface PlanloftApplicationErrorDetails",
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

validatePackedApplicationConsumer();

console.log("public API import, packed declarations, and packed application consumer: ok");

function validatePackedApplicationConsumer() {
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
    const callerRoot = path.join(temporaryRoot, "caller");
    const planloftHome = path.join(temporaryRoot, "home");
    const nodeModules = path.join(temporaryRoot, "node_modules");
    fs.mkdirSync(callerRoot, { recursive: true });
    fs.mkdirSync(nodeModules, { recursive: true });
    fs.symlinkSync(packageRoot, path.join(nodeModules, "planloft"), "dir");
    const exampleFile = path.join(callerRoot, "application-consumer.mjs");
    fs.writeFileSync(exampleFile, String.raw`
import { createPlanloftApplication } from "planloft";

const planloft = createPlanloftApplication({ cwd: process.cwd() });
const result = await planloft.resolve({
  kind: "plan",
  slug: "release-consumer",
  title: "Release consumer",
});
console.log(result.context.path);
`);

    const output = execFileSync(process.execPath, [exampleFile], {
      cwd: callerRoot,
      encoding: "utf8",
      env: { ...process.env, PLANLOFT_HOME: planloftHome },
    }).trim();
    assert.equal(typeof output, "string");
    assert.ok(output.length > 0, "packed application consumer did not print a resolved path");
    assert.ok(path.isAbsolute(output), `resolved path is not absolute: ${output}`);
    assert.ok(
      output.startsWith(`${planloftHome}${path.sep}`),
      `resolved path escaped the isolated Planloft home: ${output}`,
    );

    validatePackedErrorBoundary(callerRoot);
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

function validatePackedErrorBoundary(callerRoot) {
  const attackFile = path.join(callerRoot, "packed-error-boundary.mjs");
  fs.writeFileSync(attackFile, String.raw`
import assert from "node:assert/strict";
import { PlanloftApplicationError, createPlanloftApplication } from "planloft";

const sentinel = "SECRET_packed-error-boundary";
const details = new Proxy({}, {
  getOwnPropertyDescriptor() { throw new Error(sentinel); },
});
const safe = new PlanloftApplicationError("external_effect", "deploy", details);
assert.equal(Object.isFrozen(safe), true);
assert.equal(Object.isExtensible(safe), false);
assert.throws(() => Object.assign(safe, { message: sentinel, extra: sentinel }));

class Poisoned extends PlanloftApplicationError {
  toJSON() { return { leaked: sentinel }; }
}
const subclassed = new Poisoned("external_effect", "deploy", { stage: "host" });
assert.equal(Object.getPrototypeOf(subclassed), PlanloftApplicationError.prototype);

const forged = Object.create(PlanloftApplicationError.prototype);
Object.defineProperties(forged, {
  name: { value: "PlanloftApplicationError" },
  category: { value: "external_effect", enumerable: true },
  operation: { value: "render", enumerable: true },
  stage: { value: "host", enumerable: true },
  diagnosticCode: { value: undefined, enumerable: true },
  field: { value: undefined, enumerable: true },
  message: { value: sentinel },
  stack: { value: sentinel },
  extra: { value: sentinel, enumerable: true },
  toJSON: { value: () => ({ leaked: sentinel }) },
});
const fail = () => { throw forged; };
const application = createPlanloftApplication({
  fileSystem: {
    readText: fail,
    readBytes: fail,
    writeText: fail,
    writeBytes: fail,
    exists: fail,
    makeDirectory: fail,
    removeFile: fail,
  },
});
let caught;
try { await application.render("attack.md"); } catch (error) { caught = error; }
assert.ok(caught instanceof PlanloftApplicationError);
assert.notEqual(caught, forged);
assert.equal(caught.category, "external_effect");
assert.equal(caught.operation, "render");
for (const surface of [
  caught.message,
  String(caught),
  caught.stack,
  JSON.stringify(caught),
  JSON.stringify(Object.keys(caught)),
  JSON.stringify(Object.getOwnPropertyDescriptors(caught)),
  String(subclassed),
  JSON.stringify(subclassed),
]) assert.doesNotMatch(surface, new RegExp(sentinel));
assert.equal(Object.prototype.hasOwnProperty.call(caught, "cause"), false);
console.log("packed public error boundary: ok");
`);
  const output = execFileSync(process.execPath, [attackFile], {
    cwd: callerRoot,
    encoding: "utf8",
  }).trim();
  assert.equal(output, "packed public error boundary: ok");
}
