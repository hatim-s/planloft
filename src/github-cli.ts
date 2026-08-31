import { execFileSync } from "node:child_process";

export interface GhCommandOptions {
  token?: string;
  input?: string;
}

export type GhRunner = (args: string[], options?: GhCommandOptions) => string;

export class GithubCliApiError extends Error {
  constructor(readonly status: number | undefined) {
    super(status === undefined
      ? "GitHub CLI API request failed."
      : `GitHub CLI API request failed (${status}).`);
    this.name = "GithubCliApiError";
  }
}

export function runGhCommand(args: string[], options: GhCommandOptions = {}): string {
  return execFileSync("gh", args, {
    encoding: "utf8",
    input: options.input,
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      ...(options.token === undefined ? {} : { GH_TOKEN: options.token }),
    },
  });
}

export function githubApi<T = unknown>(
  token: string,
  method: string,
  endpoint: string,
  body?: unknown,
  runGh: GhRunner = runGhCommand,
): T {
  const input = body === undefined ? undefined : JSON.stringify(body);
  const args = [
    "api",
    "--method",
    method,
    endpoint.replace(/^\//, ""),
    ...(input === undefined ? [] : ["--input", "-"]),
  ];

  let output: string;
  try {
    output = runGh(args, { token, input });
  } catch (error) {
    throw new GithubCliApiError(githubStatus(error));
  }

  if (output.trim().length === 0) return undefined as T;
  try {
    return JSON.parse(output) as T;
  } catch {
    throw new GithubCliApiError(undefined);
  }
}

function githubStatus(error: unknown): number | undefined {
  const text = errorText(error);
  const match = text.match(/\bHTTP\s+(\d{3})\b/i);
  return match?.[1] === undefined ? undefined : Number(match[1]);
}

function errorText(error: unknown): string {
  if (typeof error !== "object" || error === null) return "";
  const values: string[] = [];
  for (const property of ["message", "stderr", "stdout"] as const) {
    const descriptor = Object.getOwnPropertyDescriptor(error, property);
    if (!descriptor || !("value" in descriptor)) continue;
    if (typeof descriptor.value === "string") values.push(descriptor.value);
    else if (Buffer.isBuffer(descriptor.value)) values.push(descriptor.value.toString("utf8"));
  }
  return values.join("\n");
}
