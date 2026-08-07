import fs from "node:fs";
import path from "node:path";
import { docsDir } from "../core/paths.js";
import { projectKey } from "../core/project.js";
import { normalizeDocFile } from "../core/doc.js";

interface HookEvent {
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

/**
 * Hidden dispatcher invoked by hooks/hooks.json (ADR-0001 §D2, §D6; ADR-0008).
 * - Write under the store -> normalize frontmatter (incl. kind) + index the doc.
 * - ExitPlanMode / Codex plan Stop -> nudge the agent to persist the plan if worth keeping.
 */
export async function hook(): Promise<void> {
  let ev: HookEvent = {};
  try {
    ev = JSON.parse(await readStdin());
  } catch {
    return;
  }

  const hookEvent = ev.hook_event_name;
  const toolName = ev.tool_name;

  if (toolName === "Write") {
    const file = extractFilePath(ev.tool_input);
    if (file?.startsWith(docsDir())) {
      const { key, label } = projectKey(ev.cwd);
      try {
        normalizeDocFile(file, key, label);
      } catch {
        /* never break the user's Write on a normalize hiccup */
      }
      return;
    }
  }

  if (toolName === "ExitPlanMode") {
    writePostToolUseContext(planModeNudge());
    return;
  }

  if (
    hookEvent === "PostToolUse" &&
    ev.permission_mode === "plan" &&
    toolName &&
    /^(Write|Edit|apply_patch)$/.test(toolName) &&
    !wasNudged(ev, "post-tool-use")
  ) {
    markNudged(ev, "post-tool-use");
    writePostToolUseContext(planModeNudge());
    return;
  }

  if (hookEvent === "Stop" && shouldNudgeOnPlanStop(ev) && !wasNudged(ev, "stop")) {
    markNudged(ev, "stop");
    process.stdout.write(
      JSON.stringify({
        decision: "block",
        reason: planModeNudge(),
      }) + "\n",
    );
  }
}

function extractFilePath(input: unknown): string | undefined {
  if (!input || typeof input !== "object") return undefined;
  const record = input as Record<string, unknown>;
  const filePath = record.file_path ?? record.filePath;
  return typeof filePath === "string" ? filePath : undefined;
}

function writePostToolUseContext(additionalContext: string): void {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext },
    }) + "\n",
  );
}

function shouldNudgeOnPlanStop(ev: HookEvent): boolean {
  if (ev.permission_mode !== "plan" || ev.stop_hook_active) return false;
  const message = ev.last_assistant_message ?? "";
  if (message.length < 160) return false;
  if (/planloft|write-plan|planloft resolve/i.test(message)) return false;
  return /plan|approach|steps|implementation|migration|refactor|risk|open questions|phase/i.test(
    message,
  );
}

function planModeNudge(): string {
  return (
    "planloft: if that plan is worth keeping, persist it now via the write-plan skill " +
    "(run `planloft resolve --kind plan --slug <slug> --title <title>` and write the plan " +
    "to the returned path). If it is not a durable plan, say so briefly and finish."
  );
}

function wasNudged(ev: HookEvent, kind: string): boolean {
  return fs.existsSync(nudgeMarkerPath(ev, kind));
}

function markNudged(ev: HookEvent, kind: string): void {
  const marker = nudgeMarkerPath(ev, kind);
  fs.mkdirSync(path.dirname(marker), { recursive: true });
  fs.writeFileSync(marker, new Date().toISOString() + "\n");
}

function nudgeMarkerPath(ev: HookEvent, kind: string): string {
  const key = `${kind}-${ev.session_id ?? "session"}-${ev.turn_id ?? "turn"}`.replace(
    /[^a-zA-Z0-9._-]/g,
    "_",
  );
  return path.join(docsDir(), "..", "hook-state", `${key}.txt`);
}

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => (data += c));
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", () => resolve(data));
  });
}
