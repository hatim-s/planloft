import { execFileSync } from "node:child_process";
import { loadConfig } from "../core/config.js";
import type { HostAdapter, DeployInput } from "./adapter.js";

const REPO = "planloft-plans";

/** Is the `gh` CLI installed + authenticated? (ADR-0001 §D12) */
export function hasGh(): boolean {
  try {
    execFileSync("gh", ["auth", "status"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function ghUser(): string | null {
  try {
    return execFileSync("gh", ["api", "user", "-q", ".login"], { encoding: "utf8" }).trim();
  } catch {
    return loadConfig().github?.user ?? null;
  }
}

export const githubPages: HostAdapter = {
  name: "github-pages",
  basePath(id) {
    return `/${REPO}/p/${id}/`;
  },
  async deploy(input: DeployInput): Promise<string> {
    // TODO(impl) ADR-0001 §D12, §D15, §D20:
    //   1. Resolve gh user (gh api user) or PAT from config.
    //   2. Ensure PUBLIC repo <user>/planloft-plans exists; enable Pages.
    //   3. Self-install the pruning Action + root manifest.json if missing.
    //   4. Add `input.dist` under /p/<id>/; append
    //      { id, project, plan, createdAt, expiresAt } to manifest.json.
    //   5. Commit + push; Pages redeploys.
    const user = ghUser() ?? "<user>";
    const url = `https://${user}.github.io/${REPO}/p/${input.id}/`;
    throw new Error(
      `github-pages deploy not implemented yet (scaffold). Target URL: ${url}. See ADR-0001 §D15.`,
    );
  },
};
