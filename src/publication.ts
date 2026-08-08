import { execFileSync } from "node:child_process";
import { PUBLICATION_PRIVACY_DISCLOSURE } from "./command-knowledge.js";
import { createPlanloftConfiguration, type PlanloftConfiguration } from "./configuration.js";
import { resolveGiscusConfig } from "./core/giscus.js";
import { calculateExpiry, resolveTtlDays } from "./core/ttl.js";
import type { Config, DocMeta, GiscusConfig } from "./core/types.js";
import type { HostAdapter, HostAuthentication, Manifest } from "./hosts/adapter.js";
import { buildSite } from "./render/renderer.js";

export interface ApplicationPublicationInput {
  id: string;
  dist: string;
  ttlDays: number;
  now: Date;
  document: { project: string; slug: string; title: string; kind: string };
}

export interface ApplicationPublicationAdapterResult {
  url: string;
  expiresAt: string;
  warnings?: string[];
}

/** Secret-free host seam intended for application callers and mutation-free tests. */
export interface ApplicationPublicationAdapter {
  basePath(id: string): string;
  deploy(input: ApplicationPublicationInput): Promise<ApplicationPublicationAdapterResult>;
}

export interface PublicationOptions {
  ttl?: number;
  comments?: boolean;
}

export interface PreparedPublication {
  id: string;
  now: Date;
  ttlDays: number;
  expiresAt: string;
  theme: string;
  comments?: GiscusConfig;
  basePath: string;
  /** Internal validated configuration; never returned from the application interface. */
  config: Config;
}

export interface PublicationResult {
  url: string;
  expiresAt: string;
  ttlDays: number;
  warnings: string[];
}

export interface PublicationModuleOptions {
  configuration?: PlanloftConfiguration;
  clock?: () => Date;
  id?: () => string;
  host: HostAdapter;
  applicationAdapter?: ApplicationPublicationAdapter;
  environment?: Readonly<Record<string, string | undefined>>;
  auth?: AuthDiscoveryOptions;
}

export interface PublicationModule {
  prepare(document: DocMeta, options?: PublicationOptions): PreparedPublication;
  publish(document: DocMeta, prepared: PreparedPublication): Promise<PublicationResult>;
}

/**
 * The single publication interface. It owns TTL, comments, rendering, authentication,
 * privacy disclosure, host invocation, and the manifest policy consumed by adapters.
 */
export function createPublicationModule(options: PublicationModuleOptions): PublicationModule {
  const configuration = options.configuration ?? createPlanloftConfiguration();
  const clock = options.clock ?? (() => new Date());
  const createId = options.id ?? (() => {
    throw new Error("Publication requires an injected id generator.");
  });
  const host = options.host;

  return {
    prepare(document, publicationOptions = {}) {
      const { config, theme } = configuration.resolveProject(document.project, document.theme);
      const ttlDays = resolveTtlDays(publicationOptions.ttl, config.defaultTtlDays);
      const now = clock();
      const expiresAt = calculateExpiry(
        ttlDays,
        now,
        publicationOptions.ttl === undefined ? "config.defaultTtlDays" : "--ttl",
      );
      const comments = publicationOptions.comments
        ? resolveGiscusConfig(config, document.project)
        : undefined;
      const id = createId();
      const basePath = options.applicationAdapter
        ? options.applicationAdapter.basePath(id)
        : host.basePath(id, config);
      return { id, now, ttlDays, expiresAt, theme, comments, basePath, config };
    },

    async publish(document, prepared) {
      const dist = buildSite({
        doc: document,
        theme: prepared.theme,
        base: prepared.basePath,
        comments: prepared.comments,
        noindex: true,
      });
      const common: ApplicationPublicationInput = {
        id: prepared.id,
        dist,
        ttlDays: prepared.ttlDays,
        now: prepared.now,
        document: {
          project: document.project,
          slug: document.slug,
          title: document.title,
          kind: document.kind,
        },
      };
      const result = options.applicationAdapter
        ? await options.applicationAdapter.deploy(common)
        : await host.deploy({
            ...common,
            doc: document,
            cfg: prepared.config,
            authentication: await acquireGithubAuthentication(prepared.config, {
              ...options.auth,
              env: options.auth?.env ?? options.environment,
            }),
            updateManifest: (manifest, candidateId) =>
              updatePublicationManifest(manifest, common, candidateId, prepared.expiresAt),
            render: (id) =>
              buildSite({
                doc: document,
                theme: prepared.theme,
                base: host.basePath(id, prepared.config),
                comments: prepared.comments,
                noindex: true,
              }),
          });
      return {
        url: result.url,
        expiresAt: prepared.expiresAt,
        ttlDays: prepared.ttlDays,
        warnings: [...(result.warnings ?? []), PUBLICATION_PRIVACY_DISCLOSURE],
      };
    },
  };
}

export type GithubCredentialSource = "gh" | "environment" | "config" | "prompt";
export interface GithubCredential {
  token: string;
  source: GithubCredentialSource;
}

export type GithubAuthentication = HostAuthentication;

export const GITHUB_AUTH_MISSING = "PLANLOFT_GITHUB_AUTH_MISSING";
export const GITHUB_AUTH_INVALID = "PLANLOFT_GITHUB_AUTH_INVALID";
export const GITHUB_AUTH_UNREACHABLE = "PLANLOFT_GITHUB_AUTH_UNREACHABLE";

type GithubApi = (
  token: string,
  method: string,
  pathname: string,
  body?: unknown,
) => Promise<Response>;

export interface AuthDiscoveryOptions {
  env?: Readonly<Record<string, string | undefined>>;
  interactive?: boolean;
  promptToken?: () => Promise<string>;
  runGh?: (args: string[]) => string;
  request?: GithubApi;
}

export async function acquireGithubAuthentication(
  config: Config,
  options: AuthDiscoveryOptions = {},
): Promise<GithubAuthentication> {
  const credential = await discoverGithubCredential(config, options);
  const user = await validateGithubCredential(credential, options.request);
  return { token: credential.token, user };
}

/** Credential precedence: authenticated gh, environment, config, interactive prompt. */
export async function discoverGithubCredential(
  config: Config,
  options: AuthDiscoveryOptions = {},
): Promise<GithubCredential> {
  const environment = options.env ?? process.env;
  const runGh = options.runGh ?? runGhCommand;
  try {
    runGh(["auth", "status"]);
    const token = runGh(["auth", "token"]).trim();
    if (token) return { token, source: "gh" };
  } catch {
    // Continue through the documented fallbacks.
  }
  const environmentToken = environment.PLANLOFT_GITHUB_TOKEN?.trim();
  if (environmentToken) return { token: environmentToken, source: "environment" };
  const configuredToken = config.github?.token?.trim();
  if (configuredToken) return { token: configuredToken, source: "config" };
  const interactive = options.interactive ?? options.promptToken !== undefined;
  if (interactive && options.promptToken) {
    const token = (await options.promptToken()).trim();
    if (token) return { token, source: "prompt" };
  }
  throw new Error(
    `${GITHUB_AUTH_MISSING}: authenticate with \`gh auth login\`, set ` +
      "PLANLOFT_GITHUB_TOKEN, or configure github.token. Noninteractive deploys never prompt.",
  );
}

export async function validateGithubCredential(
  credential: GithubCredential,
  request: GithubApi = githubApi,
): Promise<string> {
  let response: Response;
  try {
    response = await request(credential.token, "GET", "/user");
  } catch {
    throw new Error(`${GITHUB_AUTH_UNREACHABLE}: could not validate GitHub credentials.`);
  }
  if (!response.ok) {
    throw new Error(
      `${GITHUB_AUTH_INVALID}: GitHub rejected the ${credential.source} credential (${response.status}).`,
    );
  }
  const login = ((await response.json()) as { login?: unknown }).login;
  if (typeof login !== "string" || login.trim().length === 0) {
    throw new Error(`${GITHUB_AUTH_INVALID}: GitHub returned no user for the credential.`);
  }
  return login;
}

function runGhCommand(args: string[]): string {
  return execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
}

const GITHUB_API = "https://api.github.com";
async function githubApi(
  token: string,
  method: string,
  pathname: string,
  body?: unknown,
): Promise<Response> {
  return fetch(pathname.startsWith("http") ? pathname : `${GITHUB_API}${pathname}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      "User-Agent": "planloft",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export type { Manifest } from "./hosts/adapter.js";

/** Stable URL and expiry policy shared by all manifest storage adapters. */
export function updatePublicationManifest(
  manifest: Manifest,
  input: ApplicationPublicationInput,
  candidateId: string,
  exactExpiry = calculateExpiry(input.ttlDays, input.now, "TTL"),
): string {
  const existing = manifest.deploys.find(
    (entry) => entry.project === input.document.project && entry.slug === input.document.slug,
  );
  const id = existing?.id ?? candidateId;
  manifest.deploys = manifest.deploys.filter((entry) => entry.id !== id);
  manifest.deploys.push({
    id,
    project: input.document.project,
    slug: input.document.slug,
    title: input.document.title,
    kind: input.document.kind,
    createdAt: existing?.createdAt ?? input.now.toISOString(),
    expiresAt: exactExpiry,
  });
  return exactExpiry;
}
