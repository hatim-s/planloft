import { docsDir } from "../core/paths.js";
import { projectKey } from "../core/project.js";
import { normalizeDocFile } from "../core/doc.js";

interface HookEvent {
  tool_name?: string;
  tool_input?: { file_path?: string };
  cwd?: string;
}

/**
 * Hidden dispatcher invoked by hooks/hooks.json on PostToolUse (ADR-0001 §D2, §D6; ADR-0002).
 * - Write under the store  -> normalize frontmatter (incl. kind) + index the doc.
 * - ExitPlanMode           -> nudge the agent to persist the plan if worth keeping.
 */
export async function hook(): Promise<void> {
  let ev: HookEvent = {};
  try {
    ev = JSON.parse(await readStdin());
  } catch {
    return;
  }

  if (ev.tool_name === "Write") {
    const file = ev.tool_input?.file_path;
    if (file && file.startsWith(docsDir())) {
      const { key, label } = projectKey(ev.cwd);
      try {
        normalizeDocFile(file, key, label);
      } catch {
        /* never break the user's Write on a normalize hiccup */
      }
    }
    return;
  }

  if (ev.tool_name === "ExitPlanMode") {
    const msg =
      "planloft: if that plan is worth keeping, persist it now via the write-plan skill " +
      "(run `planloft resolve --slug <slug> --title <title>` and Write the plan to the returned path).";
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: msg },
      }) + "\n",
    );
  }
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
