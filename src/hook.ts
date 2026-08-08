import fs from "node:fs";
import path from "node:path";
import { docsDir } from "./core/paths.js";
import { createDocumentPersistence } from "./persistence.js";

export interface HookEvent {
  hook_event_name?: string;
  tool_name?: string;
  tool_input?: unknown;
  cwd?: string;
  permission_mode?: string;
  last_assistant_message?: string | null;
  session_id?: string;
  turn_id?: string;
  stop_hook_active?: boolean;
}

export type HookProtocolOutput =
  | { hookSpecificOutput: { hookEventName: "PostToolUse"; additionalContext: string } }
  | { decision: "block"; reason: string };

export interface HookResult {
  output?: HookProtocolOutput;
}

export function executeHook(event: HookEvent, clock: () => Date = () => new Date()): HookResult {
  const toolName = event.tool_name;
  if (toolName === "Write") {
    const file = extractFilePath(event.tool_input);
    const storedFile = file === undefined ? undefined : path.resolve(event.cwd ?? process.cwd(), file);
    if (storedFile && isInsideDirectory(storedFile, docsDir())) {
      try {
        createDocumentPersistence({ cwd: event.cwd, clock }).capture(storedFile);
      } catch {
        // A hook normalization failure must never break the user's write.
      }
      return {};
    }
  }

  if (toolName === "ExitPlanMode") return { output: postToolUseOutput(planModeNudge()) };

  if (
    event.hook_event_name === "PostToolUse" &&
    event.permission_mode === "plan" &&
    toolName &&
    /^(Write|Edit|apply_patch)$/.test(toolName) &&
    !wasNudged(event, "post-tool-use")
  ) {
    markNudged(event, "post-tool-use", clock);
    return { output: postToolUseOutput(planModeNudge()) };
  }

  if (
    event.hook_event_name === "Stop" &&
    shouldNudgeOnPlanStop(event) &&
    !wasNudged(event, "stop")
  ) {
    markNudged(event, "stop", clock);
    return { output: { decision: "block", reason: planModeNudge() } };
  }
  return {};
}

function extractFilePath(input: unknown): string | undefined {
  if (!input || typeof input !== "object") return undefined;
  const record = input as Record<string, unknown>;
  const file = record.file_path ?? record.filePath;
  return typeof file === "string" ? file : undefined;
}

function isInsideDirectory(file: string, directory: string): boolean {
  const relative = path.relative(path.resolve(directory), file);
  return (
    relative !== "" &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

function postToolUseOutput(additionalContext: string): HookProtocolOutput {
  return { hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext } };
}

function shouldNudgeOnPlanStop(event: HookEvent): boolean {
  if (event.permission_mode !== "plan" || event.stop_hook_active) return false;
  const message = event.last_assistant_message ?? "";
  if (message.length < 160) return false;
  if (/planloft|write-plan|planloft resolve/i.test(message)) return false;
  return /plan|approach|steps|implementation|migration|refactor|risk|open questions|phase/i.test(message);
}

function planModeNudge(): string {
  return (
    "planloft: if that plan is worth keeping, persist it now via the write-plan skill " +
    "(run `planloft resolve --kind plan --slug <slug> --title <title>` and write the plan " +
    "to the returned path). If it is not a durable plan, say so briefly and finish."
  );
}

function wasNudged(event: HookEvent, kind: string): boolean {
  return fs.existsSync(nudgeMarkerPath(event, kind));
}

function markNudged(event: HookEvent, kind: string, clock: () => Date): void {
  const marker = nudgeMarkerPath(event, kind);
  fs.mkdirSync(path.dirname(marker), { recursive: true });
  fs.writeFileSync(marker, clock().toISOString() + "\n");
}

function nudgeMarkerPath(event: HookEvent, kind: string): string {
  const key = `${kind}-${event.session_id ?? "session"}-${event.turn_id ?? "turn"}`.replace(
    /[^a-zA-Z0-9._-]/g,
    "_",
  );
  return path.join(docsDir(), "..", "hook-state", `${key}.txt`);
}
