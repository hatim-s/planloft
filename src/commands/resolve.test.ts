import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DEFAULT_CONFIG, saveConfig } from "../core/config.js";
import type { ResolvedContext } from "../core/types.js";
import { resolve } from "./resolve.js";

test("write-plan resolution always returns a Markdown target", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "planloft-resolve-test-"));
  const previousHome = process.env.PLANLOFT_HOME;
  const originalWrite = process.stdout.write;
  let output = "";
  process.env.PLANLOFT_HOME = home;
  process.stdout.write = ((chunk: string | Uint8Array) => {
    output += chunk.toString();
    return true;
  }) as typeof process.stdout.write;

  try {
    saveConfig({ ...DEFAULT_CONFIG, planFormat: "html" });
    resolve({ kind: "plan", slug: "markdown-plan", title: "Markdown Plan" });
    const context = JSON.parse(output) as ResolvedContext;
    assert.equal(context.format, "md");
    assert.match(context.path, /markdown-plan\.md$/);
  } finally {
    process.stdout.write = originalWrite;
    if (previousHome === undefined) delete process.env.PLANLOFT_HOME;
    else process.env.PLANLOFT_HOME = previousHome;
    fs.rmSync(home, { recursive: true, force: true });
  }
});
