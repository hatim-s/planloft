import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { withPlanloftHome } from "../src/core/paths.js";
import { githubPages, pagesSourceWarning } from "../src/hosts/github-pages.js";
import type { DeployInput, Manifest } from "../src/hosts/adapter.js";
import { updatePublicationManifest } from "../src/publication.js";

type Deployment = {
  id: string;
  project: string;
  slug: string;
  title: string;
  kind: string;
  createdAt: string;
  expiresAt: string | null;
};

type PreparedPlanIndexes = {
  readme: string;
  html: string;
  count: number;
};

type PlanIndexOptions = {
  now?: Date | string;
  pagesBaseUrl?: string;
};

type PlanIndexModule = {
  preparePlanIndexes(root: string, options?: PlanIndexOptions): PreparedPlanIndexes;
  writePlanIndexes(root: string, prepared: PreparedPlanIndexes): { count: number };
  updatePlanIndexes(root: string, options?: PlanIndexOptions): { count: number };
};

type GithubPagesFixture = {
  temp: string;
  seed: string;
  remote: string;
  hosting: string;
  ghLog: string;
  bin: string;
};

type GithubCall = {
  method: string;
  endpoint: string;
  body?: unknown;
};

type GithubPagesFixtureOptions = {
  repoStatus?: number;
  pagesPostStatus?: number;
  pagesGetStatus?: number;
  seed?: (seed: string) => void;
};

type BareRemoteFixture = {
  temp: string;
  remote: string;
  seed: string;
};

const templatesDir = fileURLToPath(new URL("../templates/github-pages/", import.meta.url));
const planIndexesUrl = new URL("../templates/github-pages/update-indexes.mjs", import.meta.url).href;
const planIndexes = await import(planIndexesUrl) as PlanIndexModule;
const readmeStart = "<!-- planloft:active-plans:start -->";
const readmeEnd = "<!-- planloft:active-plans:end -->";

function deployment(overrides: Partial<Deployment> = {}): Deployment {
  return {
    id: "plan-id",
    project: "owner/repo",
    slug: "roadmap",
    title: "Roadmap",
    kind: "plan",
    createdAt: "2026-01-01T00:00:00.000Z",
    expiresAt: null,
    ...overrides,
  };
}

function writeDeployments(root: string, deploys: Deployment[]): void {
  fs.writeFileSync(
    path.join(root, "manifest.json"),
    `${JSON.stringify({ version: 1, deploys }, null, 2)}\n`,
  );
}

function updateIndexes(root: string, options: PlanIndexOptions = {}): { count: number } {
  return planIndexes.updatePlanIndexes(root, {
    pagesBaseUrl: "https://example.test/plans",
    ...options,
  });
}

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function installPruneTemplates(root: string): void {
  fs.copyFileSync(path.join(templatesDir, "prune.mjs"), path.join(root, "prune.mjs"));
  fs.copyFileSync(
    path.join(templatesDir, "update-indexes.mjs"),
    path.join(root, "update-indexes.mjs"),
  );
}

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function installFakeGh(
  directory: string,
  logPath: string,
  remote: string,
  pages: unknown,
  options: Pick<GithubPagesFixtureOptions, "repoStatus" | "pagesPostStatus" | "pagesGetStatus"> = {},
): void {
  const repoStatus = options.repoStatus ?? 200;
  const pagesPostStatus = options.pagesPostStatus ?? 409;
  const pagesGetStatus = options.pagesGetStatus ?? 200;
  const script = `#!/usr/bin/env node
const fs = require("node:fs");
const { execFileSync } = require("node:child_process");
const os = require("node:os");
const path = require("node:path");
const args = process.argv.slice(2);
const method = args[2];
const endpoint = args[3];
const inputIndex = args.indexOf("--input");
const body = inputIndex === -1 ? undefined : JSON.parse(fs.readFileSync(0, "utf8"));
const repoStatus = ${repoStatus};
const pagesPostStatus = ${pagesPostStatus};
const pagesGetStatus = ${pagesGetStatus};
const remote = ${JSON.stringify(remote)};
fs.appendFileSync(${JSON.stringify(logPath)}, JSON.stringify({ method, endpoint, body }) + "\\n");
function respond(status, output) {
  if (status >= 200 && status < 300) {
    process.stdout.write(output);
    return;
  }
  const message = status === 404 ? "Not Found" : status === 409 ? "Pages already exists" : "GitHub Pages setup failed";
  process.stderr.write("gh: " + message + " (HTTP " + status + ")");
  process.exitCode = 1;
}
if (method === "GET" && endpoint === "repos/owner/plans") {
  respond(repoStatus, "{}");
} else if (method === "POST" && endpoint === "user/repos") {
  const seed = fs.mkdtempSync(path.join(os.tmpdir(), "planloft-fake-gh-seed-"));
  try {
    execFileSync("git", ["init", "--bare", remote], { stdio: "ignore" });
    execFileSync("git", ["init", seed], { stdio: "ignore" });
    execFileSync("git", ["-C", seed, "branch", "-M", "main"], { stdio: "ignore" });
    execFileSync("git", ["-C", seed, "config", "user.name", "planloft-fake-gh"], { stdio: "ignore" });
    execFileSync("git", ["-C", seed, "config", "user.email", "fake-gh@example.test"], { stdio: "ignore" });
    fs.writeFileSync(path.join(seed, "README.md"), "# Plans\\n");
    execFileSync("git", ["-C", seed, "add", "-A"], { stdio: "ignore" });
    execFileSync("git", ["-C", seed, "commit", "-m", "initial"], { stdio: "ignore" });
    execFileSync("git", ["-C", seed, "remote", "add", "origin", remote], { stdio: "ignore" });
    execFileSync("git", ["-C", seed, "push", "-u", "origin", "HEAD:main"], { stdio: "ignore" });
    execFileSync("git", ["-C", remote, "symbolic-ref", "HEAD", "refs/heads/main"], { stdio: "ignore" });
  } finally {
    fs.rmSync(seed, { recursive: true, force: true });
  }
  respond(201, "{}");
} else if (method === "GET" && endpoint === "repos/owner/plans/pages") {
  respond(pagesGetStatus, ${JSON.stringify(JSON.stringify(pages ?? null))});
} else if (method === "POST" && endpoint === "repos/owner/plans/pages") {
  respond(pagesPostStatus, "{}");
} else {
  process.stderr.write("unexpected fake gh request");
  process.exitCode = 2;
}
`;
  fs.writeFileSync(path.join(directory, "gh"), script, { mode: 0o700 });
}

function prepareHostingClone(remote: string, hosting: string, depth?: number): void {
  fs.mkdirSync(path.dirname(hosting), { recursive: true });
  const args = ["clone", "--branch", "main"];
  if (depth !== undefined) args.push("--depth", String(depth), "--no-local");
  args.push(remote, path.basename(hosting));
  git(path.dirname(hosting), args);
}

function installPrePushRaceGit(
  directory: string,
  realGit: string,
  competitor: string,
  marker: string,
): void {
  const competingFile = path.join(competitor, "competing.txt");
  const script = `#!/usr/bin/env node
const fs = require("node:fs");
const { execFileSync } = require("node:child_process");
const args = process.argv.slice(2);
if (args.includes("push") && args.includes("--porcelain") && args.includes("HEAD:main")) {
  if (!fs.existsSync(${JSON.stringify(marker)})) {
    fs.writeFileSync(${JSON.stringify(competingFile)}, "competing remote commit\\n");
    execFileSync(${JSON.stringify(realGit)}, ["-C", ${JSON.stringify(competitor)}, "add", "competing.txt"], { stdio: "ignore" });
    execFileSync(${JSON.stringify(realGit)}, ["-C", ${JSON.stringify(competitor)}, "commit", "-m", "competing remote commit"], { stdio: "ignore" });
    execFileSync(${JSON.stringify(realGit)}, ["-C", ${JSON.stringify(competitor)}, "push", "origin", "HEAD:main"], { stdio: "ignore" });
    fs.writeFileSync(${JSON.stringify(marker)}, "fired\\n");
  }
}
execFileSync(${JSON.stringify(realGit)}, args, { stdio: "inherit" });
`;
  fs.writeFileSync(path.join(directory, "git"), script, { mode: 0o700 });
}

function initializeBareRemote(
  temp: string,
  remote: string,
  setupSeed?: (seed: string) => void,
): void {
  const seed = path.join(temp, "seed");
  fs.mkdirSync(seed);
  fs.writeFileSync(path.join(seed, "README.md"), "# Plans\n\nKeep this line.\n");
  setupSeed?.(seed);
  git(remote, ["init", "--bare"]);
  git(seed, ["init"]);
  git(seed, ["branch", "-M", "main"]);
  git(seed, ["config", "user.name", "planloft-test"]);
  git(seed, ["config", "user.email", "planloft-test@example.test"]);
  git(seed, ["add", "-A"]);
  git(seed, ["commit", "-m", "fixture"]);
  git(seed, ["remote", "add", "origin", remote]);
  git(seed, ["push", "-u", "origin", "HEAD:main"]);
}

async function withGithubPagesFixture(
  pages: unknown,
  run: (fixture: GithubPagesFixture) => Promise<void>,
  options: GithubPagesFixtureOptions = {},
): Promise<void> {
  const temp = fs.mkdtempSync(
    path.join(fs.realpathSync(os.tmpdir()), "planloft-github-deploy-test-"),
  );
  const remote = path.join(temp, "remote.git");
  const home = path.join(temp, "home");
  const bin = path.join(temp, "bin");
  const gitConfig = path.join(temp, "gitconfig");
  const ghLog = path.join(temp, "gh.log");
  const previousPath = process.env.PATH;
  const previousGitConfigGlobal = process.env.GIT_CONFIG_GLOBAL;
  const previousGitConfigNoSystem = process.env.GIT_CONFIG_NOSYSTEM;
  fs.mkdirSync(remote);
  fs.mkdirSync(bin);

  try {
    fs.writeFileSync(
      gitConfig,
      `[url "${remote}"]\n\tinsteadOf = https://github.com/owner/plans.git\n`,
    );
    installFakeGh(bin, ghLog, remote, pages, options);
    process.env.PATH = `${bin}${path.delimiter}${previousPath ?? ""}`;
    process.env.GIT_CONFIG_GLOBAL = gitConfig;
    process.env.GIT_CONFIG_NOSYSTEM = "1";
    if ((options.repoStatus ?? 200) !== 404) initializeBareRemote(temp, remote, options.seed);
    await withPlanloftHome(home, () =>
      run({
        temp,
        seed: path.join(temp, "seed"),
        remote,
        hosting: path.join(home, "hosting", "plans"),
        ghLog,
        bin,
      }),
    );
  } finally {
    restoreEnvironment("PATH", previousPath);
    restoreEnvironment("GIT_CONFIG_GLOBAL", previousGitConfigGlobal);
    restoreEnvironment("GIT_CONFIG_NOSYSTEM", previousGitConfigNoSystem);
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

function withBareRemoteFixture(
  run: (fixture: BareRemoteFixture) => void,
  setupSeed?: (seed: string) => void,
): void {
  const temp = fs.mkdtempSync(
    path.join(fs.realpathSync(os.tmpdir()), "planloft-remote-test-"),
  );
  const remote = path.join(temp, "remote.git");
  const gitConfig = path.join(temp, "gitconfig");
  const previousGitConfigGlobal = process.env.GIT_CONFIG_GLOBAL;
  const previousGitConfigNoSystem = process.env.GIT_CONFIG_NOSYSTEM;
  fs.mkdirSync(remote);

  try {
    fs.writeFileSync(gitConfig, "");
    process.env.GIT_CONFIG_GLOBAL = gitConfig;
    process.env.GIT_CONFIG_NOSYSTEM = "1";
    initializeBareRemote(temp, remote, setupSeed);
    run({ temp, remote, seed: path.join(temp, "seed") });
  } finally {
    restoreEnvironment("GIT_CONFIG_GLOBAL", previousGitConfigGlobal);
    restoreEnvironment("GIT_CONFIG_NOSYSTEM", previousGitConfigNoSystem);
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

function githubDeployInput(
  temp: string,
  id: string,
  revision: string,
  now: string,
): DeployInput {
  const date = new Date(now);
  const doc = {
    project: "owner/plans-project",
    slug: "roadmap",
    title: "Roadmap",
    kind: "plan",
    format: "md" as const,
    file: path.join(temp, `${revision}.md`),
    updatedAt: now,
  };
  const publicationInput = {
    id,
    dist: "unused",
    ttlDays: 30,
    now: date,
    document: doc,
  };

  return {
    id,
    doc,
    ttlDays: 30,
    now: date,
    cfg: {
      version: 1,
      theme: "minimal",
      defaultTtlDays: 30,
      projects: {},
      github: { repo: "plans" },
    },
    authentication: { user: "owner", token: "test-token" },
    render(renderId) {
      const dist = path.join(temp, "renders", `${revision}-${renderId}`);
      fs.mkdirSync(dist, { recursive: true });
      fs.writeFileSync(
        path.join(dist, "index.html"),
        `<!doctype html><title>${revision}</title><main>${renderId}</main>\n`,
      );
      return dist;
    },
    updateManifest(manifest, renderId) {
      return updatePublicationManifest(manifest, publicationInput, renderId);
    },
  };
}

function readManifestFile(root: string): Manifest {
  return JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8")) as Manifest;
}

function readGhLog(file: string): GithubCall[] {
  return fs.readFileSync(file, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as GithubCall);
}

test("GitHub Pages source validation protects generated index links", () => {
  assert.equal(
    pagesSourceWarning({ build_type: "legacy", source: { branch: "main", path: "/" } }),
    undefined,
  );
  const branchWarning = pagesSourceWarning({
    build_type: "legacy",
    source: { branch: "gh-pages", path: "/docs" },
  });
  assert.ok(branchWarning);
  assert.match(branchWarning, /branch gh-pages, path \/docs/);
  const workflowWarning = pagesSourceWarning({ build_type: "workflow" });
  assert.ok(workflowWarning);
  assert.match(workflowWarning, /Actions build/);
});

test("README and index symlinks cannot be read or overwritten", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "planloft-index-symlink-test-"));
  const root = path.join(temp, "site");
  const readmeSentinel = path.join(temp, "external-readme.md");
  const htmlSentinel = path.join(temp, "external-index.html");
  fs.mkdirSync(root);
  fs.writeFileSync(readmeSentinel, "external README sentinel");
  fs.writeFileSync(htmlSentinel, "external HTML sentinel");
  writeDeployments(root, [deployment()]);

  try {
    fs.symlinkSync(readmeSentinel, path.join(root, "README.md"));
    assert.throws(
      () => updateIndexes(root),
      /README\.md must not be a symbolic link/,
    );
    assert.equal(fs.readFileSync(readmeSentinel, "utf8"), "external README sentinel");
    assert.equal(fs.existsSync(path.join(root, "index.html")), false);

    fs.unlinkSync(path.join(root, "README.md"));
    fs.writeFileSync(path.join(root, "README.md"), "# Plans\n");
    fs.symlinkSync(htmlSentinel, path.join(root, "index.html"));
    assert.throws(
      () => updateIndexes(root),
      /index\.html must not be a symbolic link/,
    );
    assert.equal(fs.readFileSync(htmlSentinel, "utf8"), "external HTML sentinel");
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("injected clock and split writes preserve exact expiry boundaries", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "planloft-index-clock-test-"));
  const root = path.join(temp, "site");
  fs.mkdirSync(root);
  const now = "2026-06-01T12:00:00.000Z";
  const before = deployment({
    id: "expired-before",
    expiresAt: "2026-06-01T11:59:59.999Z",
  });
  const boundary = deployment({
    id: "boundary-plan",
    expiresAt: now,
  });
  const after = deployment({
    id: "future-plan",
    expiresAt: "2026-06-01T12:00:00.001Z",
  });
  const permanent = deployment({ id: "permanent-plan" });

  try {
    writeDeployments(root, [before, boundary, after, permanent]);
    const originalReadme = "# Plans\n\nKeep this line.\n";
    const originalHtml = "old index\n";
    fs.writeFileSync(path.join(root, "README.md"), originalReadme);
    fs.writeFileSync(path.join(root, "index.html"), originalHtml);

    const prepared = planIndexes.preparePlanIndexes(root, { now, pagesBaseUrl: "https://example.test" });
    assert.equal(prepared.count, 2);
    assert.match(prepared.readme, /future-plan/);
    assert.doesNotMatch(prepared.readme, /expired-before|boundary-plan/);
    assert.match(prepared.html, /future-plan/);
    assert.doesNotMatch(prepared.html, /expired-before|boundary-plan/);
    assert.equal(fs.readFileSync(path.join(root, "README.md"), "utf8"), originalReadme);
    assert.equal(fs.readFileSync(path.join(root, "index.html"), "utf8"), originalHtml);

    writeDeployments(root, [after, permanent]);
    fs.mkdirSync(path.join(root, "p", "expired-before"), { recursive: true });
    fs.mkdirSync(path.join(root, "p", "boundary-plan"), { recursive: true });
    fs.rmSync(path.join(root, "p", "expired-before"), { recursive: true });
    fs.rmSync(path.join(root, "p", "boundary-plan"), { recursive: true });
    planIndexes.writePlanIndexes(root, prepared);

    assert.equal(fs.readFileSync(path.join(root, "README.md"), "utf8"), prepared.readme);
    assert.equal(fs.readFileSync(path.join(root, "index.html"), "utf8"), prepared.html);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("CLI accepts an injected ISO clock with the pages base URL", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "planloft-index-cli-clock-test-"));
  const root = path.join(temp, "site");
  fs.mkdirSync(root);
  const now = "2026-06-01T12:00:00.000Z";

  try {
    fs.copyFileSync(
      path.join(templatesDir, "update-indexes.mjs"),
      path.join(root, "update-indexes.mjs"),
    );
    writeDeployments(root, [
      deployment({ id: "boundary-plan", expiresAt: now }),
      deployment({ id: "future-plan", expiresAt: "2026-06-01T12:00:00.001Z" }),
    ]);
    execFileSync(
      process.execPath,
      ["update-indexes.mjs", "https://example.test/plans", "--now", now],
      { cwd: root, stdio: "ignore" },
    );

    const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
    assert.match(readme, /future-plan/);
    assert.doesNotMatch(readme, /boundary-plan/);
    assert.match(readme, /https:\/\/example\.test\/plans\/p\/future-plan\//);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("managed README markers replace only their exact unique block", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "planloft-index-readme-marker-test-"));
  const root = path.join(temp, "site");
  fs.mkdirSync(root);

  try {
    writeDeployments(root, [deployment({ title: "Fresh plan" })]);
    const following = "\r\n## Following\r\nKeep this section exactly.\r\n";
    const readme = [
      "# Plans",
      "",
      "Keep the introduction.",
      "",
      readmeStart,
      "stale managed content",
      readmeEnd,
    ].join("\r\n") + following;
    fs.writeFileSync(path.join(root, "README.md"), readme);

    updateIndexes(root);
    const updated = fs.readFileSync(path.join(root, "README.md"), "utf8");

    assert.match(updated, /Keep the introduction\./);
    assert.match(updated, /Fresh plan/);
    assert.doesNotMatch(updated, /stale managed content/);
    assert.equal(updated.split(readmeStart).length - 1, 1);
    assert.equal(updated.split(readmeEnd).length - 1, 1);
    assert.ok(updated.endsWith(following));
    assert.equal(updated.replace(/\r\n/g, "").includes("\n"), false);
    assert.equal(updated.replace(/\r\n/g, "").includes("\r"), false);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("first run preserves an unmarked Active plans section and chooses a unique heading", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "planloft-index-readme-heading-test-"));
  const root = path.join(temp, "site");
  fs.mkdirSync(root);

  try {
    writeDeployments(root, [deployment()]);
    const readme = [
      "# Plans",
      "",
      "## Active plans",
      "",
      "This list belongs to the repository author.",
      "",
      "## Planloft active plans",
      "",
      "This heading is also user-authored.",
      "",
    ].join("\n");
    fs.writeFileSync(path.join(root, "README.md"), readme);

    updateIndexes(root);
    const updated = fs.readFileSync(path.join(root, "README.md"), "utf8");

    assert.ok(updated.startsWith(readme));
    assert.match(updated, /This list belongs to the repository author\./);
    assert.match(updated, /## Planloft active plans 2/);
    assert.ok(updated.indexOf("## Active plans") < updated.indexOf(readmeStart));
    assert.ok(updated.indexOf(readmeStart) > updated.indexOf("## Planloft active plans 2"));
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("malformed README marker pairs fail before either index is written", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "planloft-index-readme-malformed-test-"));
  const root = path.join(temp, "site");
  fs.mkdirSync(root);
  const cases = [
    {
      readme: `${readmeStart}\n${readmeEnd}\n${readmeStart}\n`,
      error: /duplicate Planloft index markers/,
    },
    {
      readme: `# Plans\n\n${readmeStart}\nManaged content\n`,
      error: /incomplete Planloft index marker pair/,
    },
    {
      readme: `# Plans\n\n${readmeEnd}\n${readmeStart}\n`,
      error: /invalid Planloft index marker order/,
    },
  ];

  try {
    writeDeployments(root, [deployment()]);
    for (const testCase of cases) {
      fs.writeFileSync(path.join(root, "README.md"), testCase.readme);
      fs.writeFileSync(path.join(root, "index.html"), "keep this index\n");
      assert.throws(() => updateIndexes(root), testCase.error);
      assert.equal(fs.readFileSync(path.join(root, "README.md"), "utf8"), testCase.readme);
      assert.equal(fs.readFileSync(path.join(root, "index.html"), "utf8"), "keep this index\n");
    }
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("root plan index has accessible semantics and overflow-safe responsive links", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "planloft-index-semantics-test-"));
  const root = path.join(temp, "site");
  fs.mkdirSync(root);
  const longValue = "unbroken-value-".repeat(20);

  try {
    writeDeployments(root, [
      deployment({
        id: `id-${longValue}`,
        project: `project-${longValue}`,
        kind: `kind-${longValue}`,
        title: `title-${longValue}`,
      }),
    ]);
    const html = planIndexes.preparePlanIndexes(root, { now: new Date("2026-06-01T00:00:00.000Z") }).html;

    assert.match(html, /<div class="plan-copy"><h2>/);
    assert.doesNotMatch(html, /<span class="plan-copy">/);
    assert.match(html, /<span class="sr-only">Plan ID: <\/span>/);
    assert.match(html, /<span class="sr-only">Project: <\/span>/);
    assert.match(html, /<span class="sr-only">Kind: <\/span>/);
    assert.match(html, /<span class="sr-only">Expires: <\/span>/);
    assert.match(html, /<span class="sr-only">1 active plan<\/span>/);
    assert.match(html, /<span class="count-visual" aria-hidden="true">/);
    assert.equal((html.match(/>1 active plan</g) ?? []).length, 1);
    assert.match(html, /<span class="open">Open plan<\/span>/);
    assert.match(html, /a:focus-visible \{[\s\S]*?outline: 3px solid var\(--accent\)/);
    assert.match(html, /\.id,[\s\S]*?overflow-wrap: anywhere;[\s\S]*?word-break: break-word;/);
    assert.match(html, /@media \(max-width: 46rem\)/);
    assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1">/);
    assert.match(html, /<ol class="index" role="list">/);

    writeDeployments(root, []);
    const emptyHtml = planIndexes.preparePlanIndexes(root).html;
    assert.doesNotMatch(emptyHtml, /<ol class="index"/);
    assert.match(emptyHtml, /<section class="empty" aria-labelledby="empty-heading">/);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("githubPages.deploy creates a fresh repository through the API and uses the bare remote for Git", async () => {
  const pages = { build_type: "legacy", source: { branch: "main", path: "/" } };

  await withGithubPagesFixture(
    pages,
    async ({ temp, remote, hosting, ghLog }) => {
      const result = await githubPages.deploy(
        githubDeployInput(temp, "fresh-id", "fresh-revision", "2026-05-01T00:00:00.000Z"),
      );
      const manifestContents = fs.readFileSync(path.join(hosting, "manifest.json"), "utf8");
      const manifest = readManifestFile(hosting);
      const readme = fs.readFileSync(path.join(hosting, "README.md"), "utf8");
      const html = fs.readFileSync(path.join(hosting, "index.html"), "utf8");

      assert.equal(result.warnings, undefined);
      assert.equal(result.url, "https://owner.github.io/plans/p/fresh-id/");
      assert.equal(result.expiresAt, "2026-05-31T00:00:00.000Z");
      assert.deepEqual(manifest, {
        version: 1,
        deploys: [
          {
            id: "fresh-id",
            project: "owner/plans-project",
            slug: "roadmap",
            title: "Roadmap",
            kind: "plan",
            createdAt: "2026-05-01T00:00:00.000Z",
            expiresAt: "2026-05-31T00:00:00.000Z",
          },
        ],
      });
      assert.ok(readme.includes(`| [Roadmap](https://owner.github.io/plans/p/fresh-id/) |`));
      assert.ok(html.includes('href="./p/fresh-id/"'));
      assert.equal(git(hosting, ["status", "--porcelain"]).trim(), "");
      assert.equal(git(remote, ["rev-list", "--count", "main"]).trim(), "2");
      assert.equal(git(remote, ["show", "main:manifest.json"]), manifestContents);
      assert.equal(git(remote, ["show", "main:README.md"]), readme);
      assert.equal(git(remote, ["show", "main:index.html"]), html);
      assert.ok(git(remote, ["show", "main:p/fresh-id/index.html"]).includes("fresh-revision"));

      const remoteMain = git(remote, ["rev-parse", "main"]).trim();
      assert.equal(
        git(hosting, ["ls-remote", "origin", "refs/heads/main"]).split(/\s+/)[0],
        remoteMain,
      );

      const calls = readGhLog(ghLog);
      assert.deepEqual(
        calls.map(({ method, endpoint }) => [method, endpoint]),
        [
          ["GET", "repos/owner/plans"],
          ["POST", "user/repos"],
          ["POST", "repos/owner/plans/pages"],
        ],
      );
      assert.deepEqual(calls[1]?.body, {
        name: "plans",
        private: false,
        auto_init: true,
        description: "planloft plan/doc deploys",
      });
      assert.deepEqual(calls[2]?.body, { source: { branch: "main", path: "/" } });
    },
    { repoStatus: 404, pagesPostStatus: 201 },
  );
});

test("githubPages.deploy pushes first deploy and stable redeploy to a local Pages repo", async () => {
  const pages = { build_type: "legacy", source: { branch: "main", path: "/" } };

  await withGithubPagesFixture(pages, async ({ temp, remote, hosting, ghLog }) => {
    const first = await githubPages.deploy(
      githubDeployInput(temp, "first-candidate", "first-revision", "2026-01-01T00:00:00.000Z"),
    );
    const firstManifestContents = fs.readFileSync(path.join(hosting, "manifest.json"), "utf8");
    const firstManifest = readManifestFile(hosting);
    const firstEntry = firstManifest.deploys[0];
    assert.ok(firstEntry);
    const stableId = firstEntry.id;
    assert.equal(stableId, "first-candidate");
    assert.equal(firstEntry.createdAt, "2026-01-01T00:00:00.000Z");
    assert.equal(firstEntry.expiresAt, "2026-01-31T00:00:00.000Z");
    assert.equal(first.expiresAt, firstEntry.expiresAt);
    assert.equal(first.url, `https://owner.github.io/plans/p/${stableId}/`);
    assert.equal(first.warnings, undefined);

    const firstReadme = fs.readFileSync(path.join(hosting, "README.md"), "utf8");
    const firstHtml = fs.readFileSync(path.join(hosting, "index.html"), "utf8");
    assert.ok(firstReadme.includes(readmeStart));
    assert.ok(firstReadme.includes(readmeEnd));
    assert.ok(
      firstReadme.includes(`| [Roadmap](https://owner.github.io/plans/p/${stableId}/) |`),
    );
    assert.ok(firstHtml.includes(`href="./p/${stableId}/"`));
    for (const script of ["prune.mjs", "update-indexes.mjs"]) {
      assert.equal(
        fs.readFileSync(path.join(hosting, ".planloft", script), "utf8"),
        fs.readFileSync(path.join(templatesDir, script), "utf8"),
      );
      assert.doesNotThrow(() => git(remote, ["cat-file", "-e", `main:.planloft/${script}`]));
    }
    assert.equal(git(hosting, ["status", "--porcelain"]).trim(), "");
    assert.equal(git(remote, ["rev-list", "--count", "main"]).trim(), "2");
    assert.equal(
      git(remote, ["log", "-1", "--format=%s", "main"]).trim(),
      `planloft: deploy roadmap (${stableId})`,
    );
    assert.equal(git(remote, ["show", "main:README.md"]), firstReadme);
    assert.equal(git(remote, ["show", "main:index.html"]), firstHtml);
    assert.equal(
      (JSON.parse(git(remote, ["show", "main:manifest.json"])) as Manifest).deploys[0]?.expiresAt,
      first.expiresAt,
    );
    assert.equal(git(remote, ["show", "main:manifest.json"]), firstManifestContents);

    const second = await githubPages.deploy(
      githubDeployInput(temp, "second-candidate", "second-revision", "2026-02-01T00:00:00.000Z"),
    );
    const secondManifestContents = fs.readFileSync(path.join(hosting, "manifest.json"), "utf8");
    const secondManifest = readManifestFile(hosting);
    const secondEntry = secondManifest.deploys[0];
    assert.equal(secondManifest.deploys.length, 1);
    assert.ok(secondEntry);
    assert.equal(secondEntry.id, stableId);
    assert.equal(secondEntry.createdAt, "2026-01-01T00:00:00.000Z");
    assert.equal(secondEntry.expiresAt, "2026-03-03T00:00:00.000Z");
    assert.notEqual(second.expiresAt, first.expiresAt);
    assert.equal(second.expiresAt, secondEntry.expiresAt);
    assert.equal(second.url, first.url);
    assert.doesNotMatch(JSON.stringify(secondManifest), /second-candidate/);

    const secondReadme = fs.readFileSync(path.join(hosting, "README.md"), "utf8");
    const secondHtml = fs.readFileSync(path.join(hosting, "index.html"), "utf8");
    assert.ok(secondReadme.includes(`https://owner.github.io/plans/p/${stableId}/`));
    assert.ok(secondReadme.includes("2026-03-03"));
    assert.ok(secondHtml.includes(`href="./p/${stableId}/"`));
    assert.ok(
      git(remote, ["show", `main:p/${stableId}/index.html`]).includes("second-revision"),
    );
    assert.equal(git(hosting, ["status", "--porcelain"]).trim(), "");
    assert.equal(git(remote, ["rev-list", "--count", "main"]).trim(), "3");
    assert.equal(
      git(remote, ["log", "-1", "--format=%s", "main"]).trim(),
      `planloft: deploy roadmap (${stableId})`,
    );
    assert.equal(git(remote, ["show", "main:README.md"]), secondReadme);
    assert.equal(git(remote, ["show", "main:index.html"]), secondHtml);
    assert.equal(git(remote, ["show", "main:manifest.json"]), secondManifestContents);

    const calls = readGhLog(ghLog);
    assert.deepEqual(
      calls.map(({ method, endpoint }) => [method, endpoint]),
      [
        ["GET", "repos/owner/plans"],
        ["POST", "repos/owner/plans/pages"],
        ["GET", "repos/owner/plans/pages"],
        ["GET", "repos/owner/plans"],
        ["POST", "repos/owner/plans/pages"],
        ["GET", "repos/owner/plans/pages"],
      ],
    );
    const pagePosts = calls.filter(
      ({ method, endpoint }) => method === "POST" && endpoint === "repos/owner/plans/pages",
    );
    assert.equal(pagePosts.length, 2);
    for (const call of pagePosts) {
      assert.deepEqual(call.body, { source: { branch: "main", path: "/" } });
    }
  });
});

test("githubPages.deploy rejects a live manifest entry whose plan directory is missing", async () => {
  const liveEntry = deployment({
    id: "missing-other-live-id",
    project: "owner/other-project",
    slug: "other-plan",
    expiresAt: "2099-12-31T00:00:00.000Z",
  });

  await withGithubPagesFixture(
    { build_type: "legacy", source: { branch: "main", path: "/" } },
    async ({ temp, remote, ghLog }) => {
      const remoteCommit = git(remote, ["rev-parse", "main"]).trim();
      await assert.rejects(
        githubPages.deploy(
          githubDeployInput(
            temp,
            "missing-live-id",
            "missing-live-revision",
            "2026-06-01T00:00:00.000Z",
          ),
        ),
        /missing|live deployment/i,
      );
      assert.equal(git(remote, ["rev-parse", "main"]).trim(), remoteCommit);
      assert.throws(() => git(remote, ["cat-file", "-e", "main:p/missing-other-live-id"]));
      assert.equal(fs.existsSync(path.join(temp, "renders")), false);
      assert.deepEqual(
        readGhLog(ghLog).map(({ method, endpoint }) => [method, endpoint]),
        [["GET", "repos/owner/plans"]],
      );
    },
    {
      seed(seed) {
        writeDeployments(seed, [liveEntry]);
      },
    },
  );
});

test("githubPages.deploy force-stages an existing ignored live plan directory", async () => {
  const ignoredId = "ignored-live-id";
  const ignoreContents = `p/${ignoredId}/\n`;
  const liveEntry = deployment({
    id: ignoredId,
    project: "owner/plans-project",
    slug: "roadmap",
    expiresAt: "2099-12-31T00:00:00.000Z",
  });

  await withGithubPagesFixture(
    { build_type: "legacy", source: { branch: "main", path: "/" } },
    async ({ temp, seed, remote, hosting }) => {
      prepareHostingClone(remote, hosting);
      assert.throws(() => git(remote, ["cat-file", "-e", `main:p/${ignoredId}`]));
      fs.cpSync(path.join(seed, "p"), path.join(hosting, "p"), { recursive: true });
      assert.equal(git(hosting, ["ls-files", "--", `p/${ignoredId}/index.html`]), "");

      const result = await githubPages.deploy(
        githubDeployInput(
          temp,
          ignoredId,
          "ignored-live-revision",
          "2026-06-02T00:00:00.000Z",
        ),
      );

      assert.equal(result.url, `https://owner.github.io/plans/p/${ignoredId}/`);
      assert.equal(git(remote, ["show", "main:.gitignore"]), ignoreContents);
      assert.ok(
        git(remote, ["show", `main:p/${ignoredId}/index.html`]).includes("ignored-live-revision"),
      );
      assert.equal(
        (JSON.parse(git(remote, ["show", "main:manifest.json"])) as Manifest).deploys[0]?.id,
        ignoredId,
      );
      assert.equal(git(hosting, ["status", "--porcelain"]).trim(), "");
    },
    {
      seed(seed) {
        fs.writeFileSync(path.join(seed, ".gitignore"), ignoreContents);
        writeDeployments(seed, [liveEntry]);
        fs.mkdirSync(path.join(seed, "p", ignoredId), { recursive: true });
        fs.writeFileSync(
          path.join(seed, "p", ignoredId, "index.html"),
          "ignored seed plan\n",
        );
      },
    },
  );
});

test("githubPages.deploy unshallows an existing depth-1 hosting clone", async () => {
  await withGithubPagesFixture(
    { build_type: "legacy", source: { branch: "main", path: "/" } },
    async ({ temp, seed, remote, hosting }) => {
      const initialCommit = git(seed, ["rev-parse", "HEAD"]).trim();
      fs.writeFileSync(path.join(seed, "history.txt"), "complete history\n");
      git(seed, ["add", "history.txt"]);
      git(seed, ["commit", "-m", "history fixture"]);
      git(seed, ["push", "origin", "HEAD:main"]);

      prepareHostingClone(remote, hosting, 1);
      assert.equal(git(hosting, ["rev-parse", "--is-shallow-repository"]).trim(), "true");

      await githubPages.deploy(
        githubDeployInput(temp, "shallow-id", "shallow-revision", "2026-06-03T00:00:00.000Z"),
      );

      assert.equal(git(hosting, ["rev-parse", "--is-shallow-repository"]).trim(), "false");
      assert.doesNotThrow(() => git(hosting, ["cat-file", "-e", `${initialCommit}:README.md`]));
      assert.equal(git(hosting, ["rev-list", "--count", "HEAD"]).trim(), "3");
      assert.equal(git(remote, ["rev-list", "--count", "main"]).trim(), "3");
      assert.ok(git(remote, ["show", "main:p/shallow-id/index.html"]).includes("shallow-revision"));
      assert.equal(git(hosting, ["status", "--porcelain"]).trim(), "");
    },
  );
});

test("githubPages.deploy retries after one deterministic pre-push remote race", async () => {
  await withGithubPagesFixture(
    { build_type: "legacy", source: { branch: "main", path: "/" } },
    async ({ temp, remote, hosting, ghLog, bin }) => {
      const competitor = path.join(temp, "competitor");
      const marker = path.join(temp, "pre-push-race-fired");
      git(temp, ["clone", "--branch", "main", remote, "competitor"]);
      git(competitor, ["config", "user.name", "planloft-competitor"]);
      git(competitor, ["config", "user.email", "competitor@example.test"]);
      const realGit = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
      installPrePushRaceGit(bin, realGit, competitor, marker);

      const result = await githubPages.deploy(
        githubDeployInput(temp, "race-id", "race-revision", "2026-06-04T00:00:00.000Z"),
      );

      assert.equal(fs.existsSync(marker), true);
      assert.equal(result.url, "https://owner.github.io/plans/p/race-id/");
      assert.equal(git(remote, ["show", "main:competing.txt"]), "competing remote commit\n");
      assert.ok(git(remote, ["show", "main:p/race-id/index.html"]).includes("race-revision"));
      assert.equal(git(remote, ["rev-list", "--count", "main"]).trim(), "3");
      assert.equal(
        git(hosting, ["log", "-1", "--format=%s", "HEAD"]).trim(),
        "planloft: deploy roadmap (race-id)",
      );
      assert.equal(
        git(hosting, ["log", "-1", "--format=%s", "HEAD^"]).trim(),
        "competing remote commit",
      );
      assert.equal(git(hosting, ["status", "--porcelain"]).trim(), "");
      assert.deepEqual(
        readGhLog(ghLog).map(({ method, endpoint }) => [method, endpoint]),
        [
          ["GET", "repos/owner/plans"],
          ["POST", "repos/owner/plans/pages"],
          ["GET", "repos/owner/plans/pages"],
        ],
      );
    },
  );
});

test("githubPages.deploy rejects a malformed existing remote manifest without pushing", async () => {
  const baseEntry = deployment({ id: "existing-id" });
  const cases = [
    { name: "invalid-json", contents: "{not-json\n" },
    {
      name: "unsafe-id",
      contents: `${JSON.stringify({ version: 1, deploys: [{ ...baseEntry, id: "../outside" }] }, null, 2)}\n`,
    },
    {
      name: "noncanonical-time",
      contents: `${JSON.stringify(
        { version: 1, deploys: [{ ...baseEntry, createdAt: "2026-01-01T00:00:00Z" }] },
        null,
        2,
      )}\n`,
    },
  ];

  for (const testCase of cases) {
    await withGithubPagesFixture(
      { build_type: "legacy", source: { branch: "main", path: "/" } },
      async ({ temp, remote, ghLog }) => {
        const remoteCommit = git(remote, ["rev-parse", "main"]).trim();
        await assert.rejects(
          githubPages.deploy(
            githubDeployInput(
              temp,
              `candidate-${testCase.name}`,
              `revision-${testCase.name}`,
              "2026-04-01T00:00:00.000Z",
            ),
          ),
          /manifest is invalid/i,
        );
        assert.equal(git(remote, ["rev-parse", "main"]).trim(), remoteCommit);
        assert.equal(git(remote, ["show", "main:manifest.json"]), testCase.contents);
        assert.deepEqual(
          readGhLog(ghLog).map(({ method, endpoint }) => [method, endpoint]),
          [["GET", "repos/owner/plans"]],
        );
      },
      {
        seed(seed) {
          fs.writeFileSync(path.join(seed, "manifest.json"), testCase.contents);
        },
      },
    );
  }
});

test("githubPages.deploy rejects a tracked p symlink before touching its external target", async () => {
  await withGithubPagesFixture(
    { build_type: "legacy", source: { branch: "main", path: "/" } },
    async ({ temp, remote, hosting, ghLog }) => {
      const remoteCommit = git(remote, ["rev-parse", "main"]).trim();
      await assert.rejects(
        githubPages.deploy(
          githubDeployInput(
            temp,
            "protected-id",
            "protected-revision",
            "2026-04-02T00:00:00.000Z",
          ),
        ),
        /symbolic link|symlink/i,
      );
      assert.equal(
        fs.readFileSync(path.join(temp, "external-p", "protected-id", "index.html"), "utf8"),
        "external plan sentinel",
      );
      assert.equal(fs.lstatSync(path.join(hosting, "p")).isSymbolicLink(), true);
      assert.equal(git(remote, ["rev-parse", "main"]).trim(), remoteCommit);
      assert.deepEqual(
        readGhLog(ghLog).map(({ method, endpoint }) => [method, endpoint]),
        [["GET", "repos/owner/plans"]],
      );
    },
    {
      seed(seed) {
        const externalPlan = path.join(path.dirname(seed), "external-p", "protected-id");
        fs.mkdirSync(externalPlan, { recursive: true });
        fs.writeFileSync(path.join(externalPlan, "index.html"), "external plan sentinel");
        writeDeployments(seed, [deployment({ id: "protected-id" })]);
        fs.symlinkSync(path.dirname(externalPlan), path.join(seed, "p"));
      },
    },
  );
});

test("githubPages.deploy rejects a tracked .planloft symlink before overwriting scaffold files", async () => {
  await withGithubPagesFixture(
    { build_type: "legacy", source: { branch: "main", path: "/" } },
    async ({ temp, remote, ghLog }) => {
      const remoteCommit = git(remote, ["rev-parse", "main"]).trim();
      await assert.rejects(
        githubPages.deploy(
          githubDeployInput(
            temp,
            "scaffold-link-candidate",
            "scaffold-link-revision",
            "2026-04-02T12:00:00.000Z",
          ),
        ),
        /\.planloft.*(?:symbolic link|symlink)|(?:symbolic link|symlink).*\.planloft/i,
      );
      assert.equal(
        fs.readFileSync(path.join(temp, "external-planloft", "sentinel.txt"), "utf8"),
        "external scaffold sentinel",
      );
      assert.equal(git(remote, ["rev-parse", "main"]).trim(), remoteCommit);
      assert.deepEqual(
        readGhLog(ghLog).map(({ method, endpoint }) => [method, endpoint]),
        [["GET", "repos/owner/plans"]],
      );
    },
    {
      seed(seed) {
        const external = path.join(path.dirname(seed), "external-planloft");
        fs.mkdirSync(external);
        fs.writeFileSync(path.join(external, "sentinel.txt"), "external scaffold sentinel");
        fs.symlinkSync(external, path.join(seed, ".planloft"));
      },
    },
  );
});

test("githubPages.deploy rejects a tracked manifest symlink without reading its target", async () => {
  await withGithubPagesFixture(
    { build_type: "legacy", source: { branch: "main", path: "/" } },
    async ({ temp, remote, hosting, ghLog }) => {
      const target = path.join(temp, "external-manifest.json");
      const targetContents = `${JSON.stringify({ version: 1, deploys: [] }, null, 2)}\n`;
      const remoteCommit = git(remote, ["rev-parse", "main"]).trim();
      await assert.rejects(
        githubPages.deploy(
          githubDeployInput(
            temp,
            "manifest-link-candidate",
            "manifest-link-revision",
            "2026-04-03T00:00:00.000Z",
          ),
        ),
        /manifest\.json.*(?:symbolic link|symlink)|(?:symbolic link|symlink).*manifest\.json/i,
      );
      assert.equal(fs.readFileSync(target, "utf8"), targetContents);
      assert.equal(fs.lstatSync(path.join(hosting, "manifest.json")).isSymbolicLink(), true);
      assert.equal(git(remote, ["rev-parse", "main"]).trim(), remoteCommit);
      assert.equal(git(remote, ["show", "main:manifest.json"]), target);
      assert.deepEqual(
        readGhLog(ghLog).map(({ method, endpoint }) => [method, endpoint]),
        [["GET", "repos/owner/plans"]],
      );
    },
    {
      seed(seed) {
        const target = path.join(path.dirname(seed), "external-manifest.json");
        fs.writeFileSync(target, `${JSON.stringify({ version: 1, deploys: [] }, null, 2)}\n`);
        fs.symlinkSync(target, path.join(seed, "manifest.json"));
      },
    },
  );
});

test("githubPages.deploy treats a fatal Pages setup response as fatal without changing remote main", async () => {
  await withGithubPagesFixture(
    { build_type: "legacy", source: { branch: "main", path: "/" } },
    async ({ temp, remote, ghLog }) => {
      const remoteCommit = git(remote, ["rev-parse", "main"]).trim();
      const remoteReadme = git(remote, ["show", "main:README.md"]);
      await assert.rejects(
        githubPages.deploy(
          githubDeployInput(
            temp,
            "pages-failure-candidate",
            "pages-failure-revision",
            "2026-04-04T00:00:00.000Z",
          ),
        ),
        /GitHub Pages/i,
      );
      assert.equal(git(remote, ["rev-parse", "main"]).trim(), remoteCommit);
      assert.equal(git(remote, ["show", "main:README.md"]), remoteReadme);
      assert.deepEqual(
        readGhLog(ghLog).map(({ method, endpoint }) => [method, endpoint]),
        [
          ["GET", "repos/owner/plans"],
          ["POST", "repos/owner/plans/pages"],
        ],
      );
    },
    { pagesPostStatus: 500 },
  );
});

test("githubPages.deploy rejects when Pages exists and its source cannot be read without changing remote main", async () => {
  await withGithubPagesFixture(
    { build_type: "legacy", source: { branch: "main", path: "/" } },
    async ({ temp, remote, ghLog }) => {
      const remoteCommit = git(remote, ["rev-parse", "main"]).trim();
      const remoteReadme = git(remote, ["show", "main:README.md"]);
      await assert.rejects(
        githubPages.deploy(
          githubDeployInput(
            temp,
            "pages-read-failure-candidate",
            "pages-read-failure-revision",
            "2026-04-05T00:00:00.000Z",
          ),
        ),
        /Failed to read the GitHub Pages source/i,
      );
      assert.equal(git(remote, ["rev-parse", "main"]).trim(), remoteCommit);
      assert.equal(git(remote, ["show", "main:README.md"]), remoteReadme);
      assert.deepEqual(
        readGhLog(ghLog).map(({ method, endpoint }) => [method, endpoint]),
        [
          ["GET", "repos/owner/plans"],
          ["POST", "repos/owner/plans/pages"],
          ["GET", "repos/owner/plans/pages"],
        ],
      );
    },
    { pagesPostStatus: 409, pagesGetStatus: 500 },
  );
});

test("githubPages.deploy rejects an unsupported existing Pages source", async () => {
  await withGithubPagesFixture(
    { build_type: "workflow" },
    async ({ temp, remote, ghLog }) => {
      const remoteCommit = git(remote, ["rev-parse", "main"]).trim();
      const remoteTree = git(remote, ["rev-parse", "main^{tree}"]).trim();
      const remoteReadme = git(remote, ["show", "main:README.md"]);
      await assert.rejects(
        githubPages.deploy(
          githubDeployInput(
            temp,
            "unsupported-candidate",
            "unsupported-revision",
            "2026-04-01T00:00:00.000Z",
          ),
        ),
        /GitHub Pages uses an Actions build, not legacy branch main, path \//,
      );
      assert.equal(git(remote, ["rev-parse", "main"]).trim(), remoteCommit);
      assert.equal(git(remote, ["rev-parse", "main^{tree}"]).trim(), remoteTree);
      assert.equal(git(remote, ["show", "main:README.md"]), remoteReadme);
      assert.deepEqual(
        readGhLog(ghLog).map(({ method, endpoint }) => [method, endpoint]),
        [
          ["GET", "repos/owner/plans"],
          ["POST", "repos/owner/plans/pages"],
          ["GET", "repos/owner/plans/pages"],
        ],
      );
    },
  );
});

test("GitHub Pages pruning refreshes live plan indexes idempotently", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "planloft-index-test-"));
  const root = path.join(temp, "site");
  const remote = path.join(temp, "remote.git");
  fs.mkdirSync(root);
  fs.mkdirSync(remote);

  try {
    installPruneTemplates(root);
    fs.writeFileSync(
      path.join(root, "manifest.json"),
      `${JSON.stringify({
        version: 1,
        deploys: [
          {
            id: "live-id",
            project: "owner/repo|docs_*~",
            slug: "roadmap",
            title: 'Roadmap <script>alert("x")</script> & review',
            kind: "plan",
            createdAt: "2026-01-01T00:00:00.000Z",
            expiresAt: null,
          },
          {
            id: "expired-id",
            project: "owner/old",
            slug: "old-plan",
            title: "Expired plan",
            kind: "plan",
            createdAt: "2025-01-01T00:00:00.000Z",
            expiresAt: "2000-01-01T00:00:00.000Z",
          },
        ],
      }, null, 2)}\n`,
    );
    fs.writeFileSync(path.join(root, "README.md"), "# Plans\n\nKeep this line.\n");
    fs.mkdirSync(path.join(root, "p", "live-id"), { recursive: true });
    fs.mkdirSync(path.join(root, "p", "expired-id"), { recursive: true });
    fs.writeFileSync(path.join(root, "p", "live-id", "index.html"), "live");
    fs.writeFileSync(path.join(root, "p", "expired-id", "index.html"), "expired");

    git(root, ["init"]);
    git(root, ["branch", "-M", "main"]);
    git(root, ["config", "user.name", "planloft-test"]);
    git(root, ["config", "user.email", "planloft-test@example.test"]);
    git(root, ["add", "-A"]);
    git(root, ["commit", "-m", "fixture"]);
    git(remote, ["init", "--bare"]);
    git(root, ["remote", "add", "origin", "https://github.com/owner/plans.git"]);
    git(root, ["remote", "set-url", "--add", "--push", "origin", remote]);
    git(root, ["push", "-u", "origin", "HEAD:main"]);
    const initialCommit = git(root, ["rev-parse", "HEAD"]).trim();
    assert.equal(git(remote, ["rev-parse", "main"]).trim(), initialCommit);

    execFileSync(process.execPath, ["prune.mjs"], { cwd: root, stdio: "ignore" });

    const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
    const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
    const manifestContents = fs.readFileSync(path.join(root, "manifest.json"), "utf8");
    const manifest = readManifestFile(root);
    assert.match(readme, /Keep this line\./);
    assert.match(readme, /## Active plans/);
    assert.match(readme, /https:\/\/owner\.github\.io\/plans\/p\/live-id\//);
    assert.match(readme, /Roadmap &lt;script&gt;alert\("x"\)&lt;\/script&gt; &amp; review/);
    assert.ok(readme.includes(String.raw`owner/repo\|docs\_\*\~`));
    assert.match(html, /href="\.\/p\/live-id\/"/);
    assert.match(html, /Roadmap &lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt; &amp; review/);
    assert.doesNotMatch(html, /<script>alert/);
    assert.doesNotMatch(`${readme}\n${html}`, /expired-id|>Expired plan</);
    assert.deepEqual(manifest.deploys.map(({ id }) => id), ["live-id"]);
    assert.equal(fs.readFileSync(path.join(root, "p", "live-id", "index.html"), "utf8"), "live");
    assert.equal(fs.existsSync(path.join(root, "p", "expired-id")), false);
    assert.equal(git(root, ["status", "--porcelain"]).trim(), "");
    assert.equal(git(root, ["log", "-1", "--format=%s"]).trim(), "planloft: prune 1 expired plan(s)");

    const pruneCommit = git(root, ["rev-parse", "HEAD"]).trim();
    assert.notEqual(pruneCommit, initialCommit);
    assert.equal(git(remote, ["rev-parse", "main"]).trim(), pruneCommit);
    assert.equal(git(remote, ["rev-list", "--count", "main"]).trim(), "2");
    assert.equal(git(remote, ["show", "main:README.md"]), readme);
    assert.equal(git(remote, ["show", "main:index.html"]), html);
    assert.equal(git(remote, ["show", "main:manifest.json"]), manifestContents);
    assert.doesNotThrow(() => git(remote, ["cat-file", "-e", "main:p/live-id/index.html"]));
    assert.throws(() => git(remote, ["cat-file", "-e", "main:p/expired-id"]));

    execFileSync(process.execPath, ["prune.mjs"], { cwd: root, stdio: "ignore" });
    assert.equal(fs.readFileSync(path.join(root, "README.md"), "utf8"), readme);
    assert.equal(fs.readFileSync(path.join(root, "index.html"), "utf8"), html);
    assert.equal(readManifestFile(root).deploys.length, 1);
    assert.equal(git(root, ["rev-parse", "HEAD"]).trim(), pruneCommit);
    assert.equal(git(remote, ["rev-parse", "main"]).trim(), pruneCommit);
    assert.equal(git(remote, ["show", "main:manifest.json"]), manifestContents);
    assert.equal(git(root, ["log", "-1", "--format=%s"]).trim(), "planloft: prune 1 expired plan(s)");

    fs.writeFileSync(path.join(root, "index.html"), "stale index\n");
    git(root, ["add", "index.html"]);
    git(root, ["commit", "-m", "stale index fixture"]);
    const staleCommit = git(root, ["rev-parse", "HEAD"]).trim();
    assert.equal(git(remote, ["rev-parse", "main"]).trim(), pruneCommit);
    execFileSync(process.execPath, ["prune.mjs"], { cwd: root, stdio: "ignore" });
    const refreshedHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");
    const refreshedManifestContents = fs.readFileSync(path.join(root, "manifest.json"), "utf8");
    const refreshCommit = git(root, ["rev-parse", "HEAD"]).trim();
    assert.ok(refreshedHtml.includes('href="./p/live-id/"'));
    assert.equal(fs.readFileSync(path.join(root, "p", "live-id", "index.html"), "utf8"), "live");
    assert.equal(readManifestFile(root).deploys.length, 1);
    assert.notEqual(refreshCommit, staleCommit);
    assert.notEqual(refreshCommit, pruneCommit);
    assert.equal(git(root, ["log", "-1", "--format=%s"]).trim(), "planloft: refresh plan indexes");
    assert.equal(git(remote, ["rev-parse", "main"]).trim(), refreshCommit);
    assert.equal(git(remote, ["rev-list", "--count", "main"]).trim(), "4");
    assert.equal(git(remote, ["show", "main:index.html"]), refreshedHtml);
    assert.equal(git(remote, ["show", "main:manifest.json"]), refreshedManifestContents);
    assert.equal(git(root, ["status", "--porcelain"]).trim(), "");
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("pruning --now removes entries at or before the exact millisecond boundary", () => {
  const now = "2026-06-01T12:00:00.000Z";
  const entries = [
    deployment({
      id: "before-boundary",
      expiresAt: "2026-06-01T11:59:59.999Z",
    }),
    deployment({
      id: "at-boundary",
      expiresAt: now,
    }),
    deployment({
      id: "after-boundary",
      expiresAt: "2026-06-01T12:00:00.001Z",
    }),
  ];

  withBareRemoteFixture(
    ({ remote, seed }) => {
      const output = execFileSync(process.execPath, ["prune.mjs", "--now", now], {
        cwd: seed,
        encoding: "utf8",
      }).trim();
      const manifestContents = fs.readFileSync(path.join(seed, "manifest.json"), "utf8");
      const commit = git(seed, ["rev-parse", "HEAD"]).trim();

      assert.equal(output, "planloft-prune: removed 2, kept 1.");
      assert.deepEqual(readManifestFile(seed).deploys.map(({ id }) => id), ["after-boundary"]);
      assert.equal(fs.existsSync(path.join(seed, "p", "before-boundary")), false);
      assert.equal(fs.existsSync(path.join(seed, "p", "at-boundary")), false);
      assert.equal(
        fs.readFileSync(path.join(seed, "p", "after-boundary", "index.html"), "utf8"),
        "after-boundary",
      );
      assert.equal(git(seed, ["status", "--porcelain"]).trim(), "");
      assert.equal(git(remote, ["rev-parse", "main"]).trim(), commit);
      assert.equal(git(remote, ["show", "main:manifest.json"]), manifestContents);
      assert.throws(() => git(remote, ["cat-file", "-e", "main:p/before-boundary"]));
      assert.throws(() => git(remote, ["cat-file", "-e", "main:p/at-boundary"]));
      assert.equal(
        git(remote, ["show", "main:p/after-boundary/index.html"]),
        "after-boundary",
      );
    },
    (seed) => {
      installPruneTemplates(seed);
      writeDeployments(seed, entries);
      for (const entry of entries) {
        fs.mkdirSync(path.join(seed, "p", entry.id), { recursive: true });
        fs.writeFileSync(path.join(seed, "p", entry.id, "index.html"), entry.id);
      }
    },
  );
});

test("pruning rejects a missing live plan before removing an expired plan or rewriting indexes", () => {
  const now = "2026-01-01T00:00:00.000Z";
  const liveEntry = deployment({ id: "live-id" });
  const expiredEntry = deployment({
    id: "expired-id",
    expiresAt: "2025-12-31T23:59:59.999Z",
  });

  withBareRemoteFixture(
    ({ seed }) => {
      const manifest = fs.readFileSync(path.join(seed, "manifest.json"), "utf8");
      const expired = fs.readFileSync(path.join(seed, "p", "expired-id", "index.html"), "utf8");
      const readme = fs.readFileSync(path.join(seed, "README.md"), "utf8");
      const index = fs.readFileSync(path.join(seed, "index.html"), "utf8");
      const result = spawnSync(process.execPath, ["prune.mjs", "--now", now], {
        cwd: seed,
        encoding: "utf8",
      });

      assert.equal(result.error, undefined);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /p\/live-id is missing for a live deployment/);
      assert.equal(fs.readFileSync(path.join(seed, "manifest.json"), "utf8"), manifest);
      assert.equal(
        fs.readFileSync(path.join(seed, "p", "expired-id", "index.html"), "utf8"),
        expired,
      );
      assert.equal(fs.readFileSync(path.join(seed, "README.md"), "utf8"), readme);
      assert.equal(fs.readFileSync(path.join(seed, "index.html"), "utf8"), index);
      assert.equal(fs.existsSync(path.join(seed, "p", "live-id")), false);
    },
    (seed) => {
      installPruneTemplates(seed);
      writeDeployments(seed, [liveEntry, expiredEntry]);
      fs.writeFileSync(path.join(seed, "index.html"), "stale index\n");
      fs.mkdirSync(path.join(seed, "p", "expired-id"), { recursive: true });
      fs.writeFileSync(path.join(seed, "p", "expired-id", "index.html"), "expired\n");
    },
  );
});

test("pruning rejects a tracked p symlink before changing its expired external child", () => {
  const now = "2026-01-01T00:00:00.000Z";

  withBareRemoteFixture(
    ({ remote, seed }) => {
      const initialCommit = git(seed, ["rev-parse", "HEAD"]).trim();
      const manifestContents = fs.readFileSync(path.join(seed, "manifest.json"), "utf8");
      const externalPlan = path.join(path.dirname(seed), "external-p", "expired-id", "index.html");
      const result = spawnSync(process.execPath, ["prune.mjs", "--now", now], {
        cwd: seed,
        encoding: "utf8",
      });

      assert.equal(result.error, undefined);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /p must be a directory.*(?:symbolic link|symlink)/i);
      assert.equal(fs.readFileSync(externalPlan, "utf8"), "external expired plan sentinel");
      assert.equal(fs.lstatSync(path.join(seed, "p")).isSymbolicLink(), true);
      assert.equal(fs.readFileSync(path.join(seed, "manifest.json"), "utf8"), manifestContents);
      assert.equal(git(seed, ["rev-parse", "HEAD"]).trim(), initialCommit);
      assert.equal(git(seed, ["status", "--porcelain"]).trim(), "");
      assert.equal(git(remote, ["rev-parse", "main"]).trim(), initialCommit);
    },
    (seed) => {
      const externalRoot = path.join(path.dirname(seed), "external-p");
      fs.mkdirSync(path.join(externalRoot, "expired-id"), { recursive: true });
      fs.writeFileSync(
        path.join(externalRoot, "expired-id", "index.html"),
        "external expired plan sentinel",
      );
      installPruneTemplates(seed);
      writeDeployments(seed, [
        deployment({
          id: "expired-id",
          expiresAt: "2025-12-31T23:59:59.999Z",
        }),
      ]);
      fs.symlinkSync(externalRoot, path.join(seed, "p"));
    },
  );
});

test("pruning rejects a tracked manifest symlink before reading or changing repository files", () => {
  const targetContents = `${JSON.stringify({ version: 1, deploys: [] }, null, 2)}\n`;
  const readme = "# Plans\n\nKeep this line.\n";
  const index = "keep this index\n";
  const plan = "keep this plan\n";

  withBareRemoteFixture(
    ({ temp, remote }) => {
      const pruner = path.join(temp, "pruner");
      git(temp, ["clone", "--branch", "main", remote, "pruner"]);
      const target = path.join(temp, "external-manifest.json");
      const remoteCommit = git(remote, ["rev-parse", "main"]).trim();
      const localCommit = git(pruner, ["rev-parse", "HEAD"]).trim();

      const result = spawnSync(process.execPath, ["prune.mjs"], {
        cwd: pruner,
        encoding: "utf8",
      });

      assert.equal(result.error, undefined);
      assert.notEqual(result.status, 0);
      assert.match(
        result.stderr,
        /manifest\.json.*(?:symbolic link|symlink)|(?:symbolic link|symlink).*manifest\.json/i,
      );
      assert.equal(fs.readFileSync(target, "utf8"), targetContents);
      assert.equal(fs.readlinkSync(path.join(pruner, "manifest.json")), target);
      assert.equal(fs.readFileSync(path.join(pruner, "README.md"), "utf8"), readme);
      assert.equal(fs.readFileSync(path.join(pruner, "index.html"), "utf8"), index);
      assert.equal(fs.readFileSync(path.join(pruner, "p", "keep", "index.html"), "utf8"), plan);
      assert.equal(git(pruner, ["rev-parse", "HEAD"]).trim(), localCommit);
      assert.equal(git(pruner, ["status", "--porcelain"]).trim(), "");
      assert.equal(git(remote, ["rev-parse", "main"]).trim(), remoteCommit);
    },
    (seed) => {
      const target = path.join(path.dirname(seed), "external-manifest.json");
      fs.writeFileSync(target, targetContents);
      installPruneTemplates(seed);
      fs.symlinkSync(target, path.join(seed, "manifest.json"));
      fs.writeFileSync(path.join(seed, "index.html"), index);
      fs.mkdirSync(path.join(seed, "p", "keep"), { recursive: true });
      fs.writeFileSync(path.join(seed, "p", "keep", "index.html"), plan);
    },
  );
});

test("pruning from a non-main branch fails before manifest or plan folder changes", () => {
  withBareRemoteFixture(
    ({ remote, seed }) => {
      git(seed, ["checkout", "-b", "feature"]);
      git(seed, ["push", "-u", "origin", "feature"]);
      const manifestContents = fs.readFileSync(path.join(seed, "manifest.json"), "utf8");
      const readme = fs.readFileSync(path.join(seed, "README.md"), "utf8");
      const index = fs.readFileSync(path.join(seed, "index.html"), "utf8");
      const initialCommit = git(seed, ["rev-parse", "HEAD"]).trim();
      const remoteMain = git(remote, ["rev-parse", "main"]).trim();
      const remoteFeature = git(remote, ["rev-parse", "feature"]).trim();

      const result = spawnSync(process.execPath, ["prune.mjs"], {
        cwd: seed,
        encoding: "utf8",
      });

      assert.equal(result.error, undefined);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /must run on main|main branch|branch main|from main/i);
      assert.equal(fs.readFileSync(path.join(seed, "manifest.json"), "utf8"), manifestContents);
      assert.equal(fs.readFileSync(path.join(seed, "README.md"), "utf8"), readme);
      assert.equal(fs.readFileSync(path.join(seed, "index.html"), "utf8"), index);
      assert.equal(fs.readFileSync(path.join(seed, "p", "live-id", "index.html"), "utf8"), "live");
      assert.equal(
        fs.readFileSync(path.join(seed, "p", "expired-id", "index.html"), "utf8"),
        "expired",
      );
      assert.equal(git(seed, ["branch", "--show-current"]).trim(), "feature");
      assert.equal(git(seed, ["rev-parse", "HEAD"]).trim(), initialCommit);
      assert.equal(git(seed, ["status", "--porcelain"]).trim(), "");
      assert.equal(git(remote, ["rev-parse", "main"]).trim(), remoteMain);
      assert.equal(git(remote, ["rev-parse", "feature"]).trim(), remoteFeature);
    },
    (seed) => {
      installPruneTemplates(seed);
      writeDeployments(seed, [
        deployment({ id: "live-id", expiresAt: "2099-12-31T00:00:00.000Z" }),
        deployment({ id: "expired-id", expiresAt: "2000-01-01T00:00:00.000Z" }),
      ]);
      fs.writeFileSync(path.join(seed, "index.html"), "stale index\n");
      fs.mkdirSync(path.join(seed, "p", "live-id"), { recursive: true });
      fs.mkdirSync(path.join(seed, "p", "expired-id"), { recursive: true });
      fs.writeFileSync(path.join(seed, "p", "live-id", "index.html"), "live");
      fs.writeFileSync(path.join(seed, "p", "expired-id", "index.html"), "expired");
    },
  );
});

test("pruning leaves expired plans and manifest untouched when README preparation fails", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "planloft-index-prune-readme-test-"));
  const root = path.join(temp, "site");
  fs.mkdirSync(root);

  try {
    installPruneTemplates(root);
    writeDeployments(root, [
      deployment({ id: "live-id" }),
      deployment({ id: "expired-id", expiresAt: "2000-01-01T00:00:00.000Z" }),
    ]);
    const manifest = fs.readFileSync(path.join(root, "manifest.json"), "utf8");
    const readme = `# Plans\n\n${readmeStart}\n`;
    const index = "keep this generated index\n";
    fs.writeFileSync(path.join(root, "README.md"), readme);
    fs.writeFileSync(path.join(root, "index.html"), index);
    fs.mkdirSync(path.join(root, "p", "live-id"), { recursive: true });
    fs.mkdirSync(path.join(root, "p", "expired-id"), { recursive: true });
    fs.writeFileSync(path.join(root, "p", "live-id", "index.html"), "live");
    fs.writeFileSync(path.join(root, "p", "expired-id", "index.html"), "expired");
    git(root, ["init"]);
    git(root, ["branch", "-M", "main"]);

    const result = spawnSync(process.execPath, ["prune.mjs"], {
      cwd: root,
      encoding: "utf8",
    });

    assert.equal(result.error, undefined);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /incomplete Planloft index marker pair/);
    assert.equal(fs.readFileSync(path.join(root, "manifest.json"), "utf8"), manifest);
    assert.equal(fs.readFileSync(path.join(root, "p", "expired-id", "index.html"), "utf8"), "expired");
    assert.equal(fs.readFileSync(path.join(root, "p", "live-id", "index.html"), "utf8"), "live");
    assert.equal(fs.readFileSync(path.join(root, "README.md"), "utf8"), readme);
    assert.equal(fs.readFileSync(path.join(root, "index.html"), "utf8"), index);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("pruning rejects malformed manifests before filesystem changes", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "planloft-index-validation-test-"));
  const root = path.join(temp, "site");
  const outside = path.join(root, "outside");
  fs.mkdirSync(root);
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, "index.html"), "keep");

  try {
    installPruneTemplates(root);
    git(root, ["init"]);
    git(root, ["branch", "-M", "main"]);
    const entry = {
      id: "live-id",
      project: "owner/repo",
      slug: "roadmap",
      title: "Roadmap",
      kind: "plan",
      createdAt: "2026-01-01T00:00:00.000Z",
      expiresAt: "2099-12-31T00:00:00.000Z",
    };
    const cases = [
      {
        manifest: { version: 1, deploys: [{ ...entry, id: "../outside", expiresAt: "2000-01-01T00:00:00.000Z" }] },
        error: /safe path segment/,
      },
      {
        manifest: { version: 1, deploys: [{ ...entry, expiresAt: "not-a-date" }] },
        error: /expiresAt must be a canonical ISO timestamp or null/,
      },
      {
        manifest: {
          version: 1,
          deploys: [{ ...entry, createdAt: "2026-01-01T00:00:00Z" }],
        },
        error: /createdAt must be a canonical ISO timestamp/,
      },
      {
        manifest: {
          version: 1,
          deploys: [{ ...entry, expiresAt: "2026-01-01T01:00:00+01:00" }],
        },
        error: /expiresAt must be a canonical ISO timestamp or null/,
      },
      {
        manifest: { version: 1, deploys: [entry, { ...entry }] },
        error: /id is duplicated/,
      },
      {
        manifest: { version: 1, deploys: [{ ...entry, project: "" }] },
        error: /project must be a nonempty string/,
      },
      {
        manifest: { version: 2, deploys: [entry] },
        error: /version 1 and a deploys array are required/,
      },
    ];

    for (const testCase of cases) {
      const contents = `${JSON.stringify(testCase.manifest, null, 2)}\n`;
      fs.writeFileSync(path.join(root, "manifest.json"), contents);
      const result = spawnSync(process.execPath, ["prune.mjs"], {
        cwd: root,
        encoding: "utf8",
      });
      assert.equal(result.error, undefined);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, testCase.error);
      assert.equal(fs.readFileSync(path.join(root, "manifest.json"), "utf8"), contents);
      assert.equal(fs.readFileSync(path.join(outside, "index.html"), "utf8"), "keep");
      assert.equal(fs.existsSync(path.join(root, "README.md")), false);
      assert.equal(fs.existsSync(path.join(root, "index.html")), false);
    }
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
