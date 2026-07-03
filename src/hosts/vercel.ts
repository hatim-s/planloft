import { execFileSync } from "node:child_process";
import type { HostAdapter, DeployInput } from "./adapter.js";

/** Is the `vercel` CLI installed + logged in? (ADR-0001 §D13) */
export function hasVercel(): boolean {
  try {
    execFileSync("vercel", ["whoami"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export const vercel: HostAdapter = {
  name: "vercel",
  // Permanent deploy at its own domain; no base-path nesting (ADR-0001 §D11).
  basePath() {
    return "/";
  },
  async deploy(input: DeployInput): Promise<string> {
    // TODO(impl) ADR-0001 §D13:
    //   `vercel deploy --prebuilt <dist>` when the CLI is present,
    //   else POST to the Vercel REST API with a token from config. Permanent (no TTL).
    const url = `https://planloft-${input.id}.vercel.app/`;
    throw new Error(
      `vercel deploy not implemented yet (scaffold). Target URL: ${url}. See ADR-0001 §D13.`,
    );
  },
};
