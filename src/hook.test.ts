import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { withPlanloftHome } from "./core/paths.js";
import { executeHook } from "./hook.js";

test("plan-mode Write outside the Planloft store reaches the persistence nudge", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "planloft-hook-outside-write-test-"));
  const home = path.join(root, "home");
  const cwd = path.join(root, "project");
  const outside = path.join(home, "docs-elsewhere", "draft.md");
  fs.mkdirSync(path.dirname(outside), { recursive: true });
  fs.mkdirSync(cwd, { recursive: true });
  fs.writeFileSync(outside, "# Draft\n");

  try {
    const result = withPlanloftHome(home, () =>
      executeHook(
        {
          hook_event_name: "PostToolUse",
          tool_name: "Write",
          tool_input: { file_path: outside },
          cwd,
          permission_mode: "plan",
          session_id: "outside",
          turn_id: "write",
        },
        () => new Date("2033-01-02T03:04:05.000Z"),
      ),
    );

    assert.equal(
      result.output && "hookSpecificOutput" in result.output
        ? result.output.hookSpecificOutput.hookEventName
        : undefined,
      "PostToolUse",
    );
    assert.match(JSON.stringify(result), /persist it now via the write-plan skill/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Write inside the Planloft store normalizes the document and returns before nudging", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "planloft-hook-store-write-test-"));
  const home = path.join(root, "home");
  const cwd = path.join(root, "project");
  const stored = path.join(home, "docs", "project", "kept.md");
  fs.mkdirSync(path.dirname(stored), { recursive: true });
  fs.mkdirSync(cwd, { recursive: true });
  fs.writeFileSync(stored, "# Kept\n");

  try {
    const result = withPlanloftHome(home, () =>
      executeHook({
        hook_event_name: "PostToolUse",
        tool_name: "Write",
        tool_input: { file_path: stored },
        cwd,
        permission_mode: "plan",
        session_id: "inside",
        turn_id: "write",
      }),
    );

    assert.deepEqual(result, {});
    assert.match(fs.readFileSync(stored, "utf8"), /kind: note/);
    assert.equal(fs.existsSync(path.join(home, "hook-state")), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
