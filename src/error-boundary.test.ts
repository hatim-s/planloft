import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  PlanloftApplicationError,
  canonicalizePlanloftApplicationError,
  createPlanloftApplication,
  type ApplicationFileSystem,
  type ApplicationOperation,
  type PlanloftApplication,
} from "./application.js";
import { createProgram } from "./program.js";

const SENTINEL = "SECRET_error-boundary_sentinel";

test("public errors are immutable value objects despite hostile details and subclasses", () => {
  let getterCalls = 0;
  const details = Object.create(null) as Record<string, unknown>;
  for (const key of ["stage", "diagnosticCode", "field"]) {
    Object.defineProperty(details, key, {
      enumerable: true,
      get() {
        getterCalls += 1;
        throw new Error(`${SENTINEL}-${key}`);
      },
    });
  }
  const getterError = new PlanloftApplicationError("external_effect", "deploy", details);
  assert.equal(getterCalls, 0);
  assert.equal(getterError.stage, undefined);
  assertSecretAbsent(getterError);

  const proxyError = new PlanloftApplicationError(
    "validation",
    "render",
    new Proxy({}, {
      getOwnPropertyDescriptor() {
        throw new Error(SENTINEL);
      },
    }),
  );
  assertSecretAbsent(proxyError);

  class PoisonedError extends PlanloftApplicationError {
    override toJSON(): Readonly<Record<string, string>> {
      return { leaked: SENTINEL };
    }
  }
  class FieldPoisonedError extends PlanloftApplicationError {
    extra = SENTINEL;
  }
  const subclassed = new PoisonedError("external_effect", "deploy", { stage: "host" });
  assert.throws(() => new FieldPoisonedError("external_effect", "deploy"));
  assert.equal(Object.getPrototypeOf(subclassed), PlanloftApplicationError.prototype);
  assert.equal(subclassed instanceof PoisonedError, false);
  assert.equal(Object.isFrozen(subclassed), true);
  assert.equal(Object.isExtensible(subclassed), false);
  assert.throws(() => Object.assign(subclassed, { message: SENTINEL, extra: SENTINEL }));
  assert.throws(() => Object.defineProperty(subclassed, "toJSON", { value: () => SENTINEL }));
  for (const property of [
    "name",
    "message",
    "stack",
    "code",
    "category",
    "operation",
    "stage",
    "diagnosticCode",
    "field",
  ]) {
    const descriptor = Object.getOwnPropertyDescriptor(subclassed, property);
    assert.ok(descriptor && "value" in descriptor, `${property} must be an own data property`);
    assert.equal(descriptor.writable, false, `${property} must be immutable`);
    assert.equal(descriptor.configurable, false, `${property} must be non-configurable`);
  }
  assertSecretAbsent(subclassed);
});

test("source application boundaries rebuild hostile public-looking errors and use safe context fallbacks", async () => {
  const forged = forgedPublicError("render");
  const fileSystem = throwingFileSystem(forged);
  const renderApplication = createPlanloftApplication({ fileSystem });
  await assert.rejects(renderApplication.render("attack.md"), (caught: unknown) => {
    assert.notEqual(caught, forged);
    assert.ok(caught instanceof PlanloftApplicationError);
    assert.equal(caught.category, "external_effect");
    assert.equal(caught.operation, "render");
    assert.equal(caught.stage, "host");
    assertSecretAbsent(caught);
    return true;
  });

  const hostileDetails = new Proxy({}, {
    getOwnPropertyDescriptor() {
      throw new Error(SENTINEL);
    },
  });
  const proxy = new Proxy(new Error(SENTINEL), {
    getOwnPropertyDescriptor() {
      throw new Error(SENTINEL);
    },
  });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "planloft-error-source-boundary-"));
  try {
    const application = createPlanloftApplication({ cwd: root, planloftHome: path.join(root, "home") });
    const options = Object.create(null);
    Object.defineProperty(options, "title", {
      get() {
        throw proxy;
      },
    });
    await assert.rejects(application.resolve(options), (caught: unknown) => {
      assert.ok(caught instanceof PlanloftApplicationError);
      assert.equal(caught.category, "local_effect");
      assert.equal(caught.operation, "resolve");
      assertSecretAbsent(caught);
      return true;
    });

    const initApplication = createPlanloftApplication({
      cwd: root,
      planloftHome: path.join(root, "init-home"),
      hasGithubCli: () => {
        throw new PlanloftApplicationError("external_effect", "init", hostileDetails);
      },
    });
    await assert.rejects(initApplication.init(), (caught: unknown) => {
      assert.ok(caught instanceof PlanloftApplicationError);
      assert.equal(caught.category, "external_effect");
      assert.equal(caught.operation, "init");
      assertSecretAbsent(caught);
      return true;
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("every CLI command independently canonicalizes hostile application errors", async () => {
  const invocations: Array<{ operation: ApplicationOperation; argv: string[]; method: keyof PlanloftApplication }> = [
    { operation: "render", argv: ["render", "attack.md"], method: "render" },
    { operation: "hoist", argv: ["hoist", "attack.md"], method: "hoist" },
    { operation: "publish", argv: ["publish", "attack.md"], method: "publish" },
    { operation: "resolve", argv: ["resolve"], method: "resolve" },
    { operation: "list", argv: ["list"], method: "list" },
    { operation: "preview", argv: ["preview"], method: "preview" },
    { operation: "copy", argv: ["copy"], method: "copy" },
    { operation: "deploy", argv: ["deploy"], method: "deploy" },
    { operation: "remove", argv: ["rm", "attack"], method: "remove" },
    { operation: "config", argv: ["config"], method: "config" },
    { operation: "init", argv: ["init"], method: "init" },
  ];

  for (const invocation of invocations) {
    const forged = forgedPublicError(invocation.operation);
    const application = new Proxy({}, {
      get(_target, property) {
        if (property === invocation.method) return async () => { throw forged; };
        return async () => { throw new Error(`unexpected method ${String(property)}`); };
      },
    }) as PlanloftApplication;
    let stderr = "";
    let exitCode: number | undefined;
    const program = createProgram({
      application,
      writeOut: () => undefined,
      writeErr: (value) => { stderr += value; },
      setExitCode: (value) => { exitCode = value; },
    });
    await program.parseAsync(["node", "planloft", ...invocation.argv]);
    assert.equal(exitCode, 1, `${invocation.operation} must fail`);
    assert.match(stderr, /failed: .*external effect/, invocation.operation);
    assert.doesNotMatch(stderr, new RegExp(SENTINEL), invocation.operation);
  }
});

test("CLI proxy traps and stdin failures fall back without leaking", async () => {
  for (const inspectedProperty of [
    "name",
    "category",
    "operation",
    "stage",
    "diagnosticCode",
    "field",
    "code",
    "message",
  ]) {
    let getterCalls = 0;
    const hostile = Object.create(null);
    Object.defineProperty(hostile, inspectedProperty, {
      get() {
        getterCalls += 1;
        throw new Error(`${SENTINEL}-${inspectedProperty}`);
      },
    });
    const canonical = canonicalizePlanloftApplicationError(hostile, "deploy");
    assert.equal(getterCalls, 0, `${inspectedProperty} getter must not run`);
    assert.equal(canonical.category, "internal");
    assertSecretAbsent(canonical);
  }

  const proxy = new Proxy({}, {
    getOwnPropertyDescriptor() {
      throw new Error(SENTINEL);
    },
  });
  let stderr = "";
  const program = createProgram({
    application: {
      ...emptyApplication(),
      deploy: async () => { throw proxy; },
    },
    writeOut: () => undefined,
    writeErr: (value) => { stderr += value; },
    setExitCode: () => undefined,
  });
  await program.parseAsync(["node", "planloft", "deploy"]);
  assert.match(stderr, /internal application error/);
  assert.doesNotMatch(stderr, new RegExp(SENTINEL));

  for (const command of ["render", "hoist", "publish"] as const) {
    let stdinOutput = "";
    const stdinProgram = createProgram({
      application: emptyApplication(),
      readStdin: async () => { throw new Error(SENTINEL); },
      writeOut: (value) => { stdinOutput += value; },
      writeErr: (value) => { stdinOutput += value; },
      setExitCode: () => undefined,
    });
    await stdinProgram.parseAsync(["node", "planloft", command, "-", "--format", "md"]);
    assert.match(stdinOutput, /internal application error/, command);
    assert.doesNotMatch(stdinOutput, new RegExp(SENTINEL), command);
  }
});

function forgedPublicError(operation: ApplicationOperation): object {
  const forged = Object.create(PlanloftApplicationError.prototype) as Record<string, unknown>;
  Object.defineProperties(forged, {
    name: { value: "PlanloftApplicationError", enumerable: false },
    category: { value: "external_effect", enumerable: true },
    operation: { value: operation, enumerable: true },
    stage: { value: "host", enumerable: true },
    diagnosticCode: { value: undefined, enumerable: true },
    field: { value: undefined, enumerable: true },
    code: { value: "poisoned-code", enumerable: true },
    message: { value: SENTINEL, enumerable: false },
    stack: { value: SENTINEL, enumerable: false },
    extra: { value: SENTINEL, enumerable: true },
    toJSON: { value: () => ({ leaked: SENTINEL }), enumerable: false },
  });
  return forged;
}

function throwingFileSystem(error: object): ApplicationFileSystem {
  const fail = (): never => { throw error; };
  return {
    readText: fail,
    readBytes: fail,
    writeText: fail,
    writeBytes: fail,
    exists: fail,
    makeDirectory: fail,
    removeFile: fail,
  };
}

function emptyApplication(): PlanloftApplication {
  const fail = async (): Promise<never> => { throw new Error("unused"); };
  return {
    render: fail,
    hoist: fail,
    publish: fail,
    resolve: fail,
    list: fail,
    preview: fail,
    copy: fail,
    deploy: fail,
    remove: fail,
    config: fail,
    init: fail,
  };
}

function assertSecretAbsent(value: unknown): void {
  const error = value as Error;
  const own = Object.getOwnPropertyDescriptors(error);
  const surfaces = [
    error.message,
    String(error),
    error.stack ?? "",
    JSON.stringify(error),
    JSON.stringify(Object.keys(error)),
    JSON.stringify(
      Reflect.ownKeys(own).map((key) => {
        const descriptor = own[key as keyof typeof own];
        return [String(key), descriptor && "value" in descriptor && typeof descriptor.value !== "function"
          ? descriptor.value
          : undefined];
      }),
    ),
  ];
  for (const surface of surfaces) assert.doesNotMatch(surface, new RegExp(SENTINEL));
  assert.equal(Object.prototype.hasOwnProperty.call(error, "cause"), false);
}
