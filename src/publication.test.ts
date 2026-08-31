import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createPlanloftApplication } from "./application.js";
import {
  createPlanloftConfiguration,
  loadConfig,
  redactConfig,
  saveConfig,
} from "./configuration.js";
import { withPlanloftHome } from "./core/paths.js";
import { resolveGiscusConfig } from "./core/giscus.js";
import {
  calculateExpiry,
  MAX_TTL_DAYS,
  parseTtlDays,
  resolveTtlDays,
} from "./core/ttl.js";
import type { Config, DocMeta } from "./core/types.js";
import type { HostAdapter } from "./hosts/adapter.js";
import { githubApi, GithubCliApiError } from "./github-cli.js";
import {
  authenticatedGit,
  configureCleanRemote,
} from "./hosts/github-pages.js";
import {
  createPublicationModule,
  discoverGithubCredential,
  GITHUB_AUTH_INVALID,
  GITHUB_AUTH_MISSING,
  GITHUB_AUTH_UNREACHABLE,
  updatePublicationManifest,
  validateGithubCredential,
  type Manifest,
} from "./publication.js";

test("GitHub API calls use gh with token-safe argv and JSON stdin", () => {
  const response = githubApi<{ id: number }>(
    "api-secret",
    "POST",
    "/user/repos",
    { name: "plans", private: false },
    (args, options) => {
      assert.deepEqual(args, ["api", "--method", "POST", "user/repos", "--input", "-"]);
      assert.doesNotMatch(args.join(" "), /api-secret/);
      assert.equal(options?.token, "api-secret");
      assert.equal(options?.input, JSON.stringify({ name: "plans", private: false }));
      return JSON.stringify({ id: 123 });
    },
  );
  assert.deepEqual(response, { id: 123 });

  assert.throws(
    () => githubApi("api-secret", "POST", "repos/owner/plans/pages", {}, () => {
      throw new Error("gh: the Pages site already exists (HTTP 409)");
    }),
    (error: Error) => {
      assert.ok(error instanceof GithubCliApiError);
      assert.equal(error.status, 409);
      assert.doesNotMatch(error.message, /api-secret/);
      return true;
    },
  );
});

test("giscus configuration resolves project values over global values", () => {
  const cfg = config({
    giscus: {
      repo: "owner/global",
      repoId: "global-repo-id",
      category: "Global category",
      categoryId: "global-category-id",
    },
    projects: {
      project: {
        giscus: { repo: "owner/project", category: "Project category" },
      },
    },
  });
  assert.deepEqual(resolveGiscusConfig(cfg, "project"), {
    repo: "owner/project",
    repoId: "global-repo-id",
    category: "Project category",
    categoryId: "global-category-id",
  });
});

test("giscus configuration fails early with every missing field named", () => {
  assert.throws(
    () => resolveGiscusConfig(config(), "project"),
    (error: Error) => {
      assert.match(error.message, /^PLANLOFT_GISCUS_CONFIG_INCOMPLETE:/);
      for (const field of ["repo", "repoId", "category", "categoryId"]) {
        assert.match(error.message, new RegExp(`giscus\\.${field}`));
      }
      return true;
    },
  );
});

test("TTL parser accepts only finite positive integers and uses config only when omitted", () => {
  assert.equal(parseTtlDays("1"), 1);
  assert.equal(parseTtlDays(90), 90);
  for (const invalid of [
    0,
    -1,
    1.2,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.MAX_SAFE_INTEGER,
    "0",
    "-1",
    "1.2",
    "3d",
    "01",
    String(Number.MAX_SAFE_INTEGER),
  ]) {
    assert.throws(() => parseTtlDays(invalid), /finite positive integer/);
  }
  assert.equal(resolveTtlDays(undefined, 30), 30);
  assert.equal(resolveTtlDays(7, 30), 7);
  assert.throws(() => resolveTtlDays(undefined, 0), /config\.defaultTtlDays/);
  assert.throws(
    () => calculateExpiry(MAX_TTL_DAYS, new Date("2026-08-08T00:00:00.000Z")),
    /does not produce a representable expiry/,
  );
  assert.equal(
    calculateExpiry(30, new Date("2026-08-01T00:00:00.000Z")),
    "2026-08-31T00:00:00.000Z",
  );
});

test("configuration validates defaultTtlDays and redacts configured credentials", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "planloft-publication-config-"));
  const previousHome = process.env.PLANLOFT_HOME;
  process.env.PLANLOFT_HOME = home;
  try {
    const valid = config({
      github: { token: "configured-secret", repo: "plans" },
      vercel: { token: "vercel-secret" },
    });
    saveConfig(valid);
    assert.equal(loadConfig().defaultTtlDays, 30);
    const printable = JSON.stringify(redactConfig(loadConfig()));
    assert.match(printable, /\[redacted\]/);
    assert.doesNotMatch(printable, /configured-secret/);
    assert.doesNotMatch(printable, /vercel-secret/);

    fs.writeFileSync(
      path.join(home, "config.json"),
      JSON.stringify({ ...valid, defaultTtlDays: 0 }),
    );
    assert.throws(() => loadConfig(), /config\.defaultTtlDays must be a finite positive integer/);
    fs.writeFileSync(
      path.join(home, "config.json"),
      JSON.stringify({ ...valid, defaultTtlDays: Number.MAX_SAFE_INTEGER }),
    );
    assert.throws(() => loadConfig(), /config\.defaultTtlDays must be a finite positive integer/);
    assert.throws(
      () => saveConfig({ ...valid, defaultTtlDays: Number.POSITIVE_INFINITY }),
      /config\.defaultTtlDays must be a finite positive integer/,
    );
    assert.throws(
      () => saveConfig({ ...valid, defaultTtlDays: Number.MAX_SAFE_INTEGER }),
      /config\.defaultTtlDays must be a finite positive integer/,
    );
  } finally {
    if (previousHome === undefined) delete process.env.PLANLOFT_HOME;
    else process.env.PLANLOFT_HOME = previousHome;
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("publish computes configured expiry before hoisting source or index files", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "planloft-publish-preflight-test-"));
  const source = path.join(home, "proposal.md");
  const previousHome = process.env.PLANLOFT_HOME;
  process.env.PLANLOFT_HOME = home;
  fs.writeFileSync(source, "# Proposal\n");
  fs.writeFileSync(
    path.join(home, "config.json"),
    JSON.stringify({ ...config(), defaultTtlDays: MAX_TTL_DAYS }),
  );
  try {
    const application = createPlanloftApplication({ planloftHome: home });
    await assert.rejects(application.publish(source), /PLANLOFT_EXPIRY_INVALID/);
    assert.equal(fs.existsSync(path.join(home, "index.json")), false);
    assert.equal(fs.existsSync(path.join(home, "docs")), false);
  } finally {
    if (previousHome === undefined) delete process.env.PLANLOFT_HOME;
    else process.env.PLANLOFT_HOME = previousHome;
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("GitHub credential discovery has stable precedence and never prompts noninteractively", async () => {
  const gh = await discoverGithubCredential(config({ github: { token: "config-token" } }), {
    env: { PLANLOFT_GITHUB_TOKEN: "environment-token" },
    interactive: false,
    runGh: (args) => (args[1] === "token" ? "gh-token\n" : ""),
  });
  assert.deepEqual(gh, { token: "gh-token", source: "gh" });

  const environment = await discoverGithubCredential(
    config({ github: { token: "config-token" } }),
    {
      env: { PLANLOFT_GITHUB_TOKEN: "environment-token" },
      interactive: false,
      runGh: () => {
        throw new Error("gh unavailable");
      },
    },
  );
  assert.deepEqual(environment, { token: "environment-token", source: "environment" });

  let prompted = false;
  const configured = await discoverGithubCredential(config({ github: { token: "config-token" } }), {
    env: {},
    interactive: true,
    runGh: () => {
      throw new Error("gh unavailable");
    },
    promptToken: async () => {
      prompted = true;
      return "prompt-token";
    },
  });
  assert.deepEqual(configured, { token: "config-token", source: "config" });
  assert.equal(prompted, false);

  await assert.rejects(
    discoverGithubCredential(config(), {
      env: {},
      interactive: false,
      runGh: () => {
        throw new Error("gh unavailable");
      },
      promptToken: async () => {
        prompted = true;
        return "prompt-token";
      },
    }),
    (error: Error) => {
      assert.match(error.message, new RegExp(`^${GITHUB_AUTH_MISSING}:`));
      return true;
    },
  );
  assert.equal(prompted, false);
});

test("interactive auth prompt is ephemeral and credential validation has stable token-safe errors", async () => {
  const prompted = await discoverGithubCredential(config(), {
    env: {},
    interactive: true,
    runGh: () => {
      throw new Error("gh unavailable");
    },
    promptToken: async () => "prompt-secret",
  });
  assert.deepEqual(prompted, { token: "prompt-secret", source: "prompt" });

  const login = await validateGithubCredential(prompted, (args, options) => {
    assert.deepEqual(args, ["api", "--method", "GET", "user"]);
    assert.equal(options?.token, "prompt-secret");
    assert.doesNotMatch(args.join(" "), /prompt-secret/);
    return JSON.stringify({ login: "hatim-s" });
  });
  assert.equal(login, "hatim-s");

  await assert.rejects(
    validateGithubCredential(prompted, () => {
      throw new Error("gh: HTTP 401");
    }),
    (error: Error) => {
      assert.match(error.message, new RegExp(`^${GITHUB_AUTH_INVALID}:`));
      assert.doesNotMatch(error.message, /prompt-secret/);
      return true;
    },
  );
  await assert.rejects(
    validateGithubCredential(prompted, () => {
      throw new Error("network includes prompt-secret");
    }),
    (error: Error) => {
      assert.match(error.message, new RegExp(`^${GITHUB_AUTH_UNREACHABLE}:`));
      assert.doesNotMatch(error.message, /prompt-secret/);
      return true;
    },
  );
});

test("authenticated Git keeps token and reversible credentials out of argv and cleans askpass", () => {
  const token = "github_pat_secret-material";
  const basic = Buffer.from(`x-access-token:${token}`).toString("base64");
  let askPass = "";
  authenticatedGit(
    "/tmp/planloft-hosting",
    ["fetch", "--depth", "1", "origin", "main"],
    token,
    ((file: string, args: readonly string[], options: { env?: NodeJS.ProcessEnv }) => {
      assert.equal(file, "git");
      const argv = args.join(" ");
      assert.doesNotMatch(argv, new RegExp(token));
      assert.doesNotMatch(argv, new RegExp(basic));
      assert.doesNotMatch(argv, /AUTHORIZATION|extraheader|basic/i);
      askPass = options.env?.GIT_ASKPASS ?? "";
      assert.ok(askPass);
      assert.equal(options.env?.PLANLOFT_GIT_TOKEN, token);
      const helper = fs.readFileSync(askPass, "utf8");
      assert.doesNotMatch(helper, new RegExp(token));
      assert.doesNotMatch(helper, new RegExp(basic));
      return Buffer.alloc(0);
    }) as typeof execFileSync,
  );
  assert.equal(fs.existsSync(path.dirname(askPass)), false);
});

test("publication clones persist and repair only clean credential-free remotes", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "planloft-clean-remote-test-"));
  const token = "github_pat_remote-secret";
  const basic = Buffer.from(`x-access-token:${token}`).toString("base64");
  const clean = "https://github.com/owner/plans.git";
  try {
    configureCleanRemote(dir, "owner", "plans");
    assert.equal(
      execFileSync("git", ["-C", dir, "remote", "get-url", "origin"], {
        encoding: "utf8",
      }).trim(),
      clean,
    );

    const credentialUrls = [
      `https://x-access-token:${token}@github.com/owner/plans.git`,
      `https://x-access-token:${basic}@github.com/owner/plans.git`,
    ];
    execFileSync("git", ["-C", dir, "remote", "set-url", "origin", credentialUrls[0]!]);
    execFileSync("git", ["-C", dir, "remote", "set-url", "--add", "origin", credentialUrls[1]!]);
    execFileSync("git", [
      "-C",
      dir,
      "remote",
      "set-url",
      "--push",
      "origin",
      credentialUrls[0]!,
    ]);
    execFileSync("git", [
      "-C",
      dir,
      "remote",
      "set-url",
      "--add",
      "--push",
      "origin",
      credentialUrls[1]!,
    ]);
    configureCleanRemote(dir, "owner", "plans");
    const fetchUrls = execFileSync("git", ["-C", dir, "remote", "get-url", "--all", "origin"], {
      encoding: "utf8",
    })
      .trim()
      .split(/\r?\n/);
    const pushUrls = execFileSync(
      "git",
      ["-C", dir, "remote", "get-url", "--push", "--all", "origin"],
      { encoding: "utf8" },
    )
      .trim()
      .split(/\r?\n/);

    assert.deepEqual(fetchUrls, [clean]);
    assert.deepEqual(pushUrls, [clean]);
    for (const url of [...fetchUrls, ...pushUrls]) {
      assert.doesNotMatch(url, new RegExp(token));
      assert.doesNotMatch(url, new RegExp(basic));
      assert.doesNotMatch(url, /x-access-token|@github\.com/);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("redeploy keeps the stable URL id and moves expiry from the injected clock", () => {
  const manifest: Manifest = { version: 1, deploys: [] };
  const input = publicationInput(30, new Date("2026-08-01T00:00:00.000Z"));
  const firstExpiry = updatePublicationManifest(
    manifest,
    input,
    "first-id",
  );
  assert.equal(firstExpiry, "2026-08-31T00:00:00.000Z");
  assert.equal(manifest.deploys[0]?.id, "first-id");

  const secondExpiry = updatePublicationManifest(
    manifest,
    publicationInput(30, new Date("2026-08-08T00:00:00.000Z")),
    "ignored-new-id",
  );
  assert.equal(secondExpiry, "2026-09-07T00:00:00.000Z");
  assert.equal(manifest.deploys[0]?.id, "first-id");
  assert.equal(manifest.deploys[0]?.createdAt, "2026-08-01T00:00:00.000Z");
});

test("the publication interface owns auth, manifest, rendering, privacy, and exact expiry without live GitHub", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "planloft-publication-interface-test-"));
  const source = path.join(home, "roadmap.md");
  fs.writeFileSync(source, "# Roadmap\n");
  let renderedDirectory = "";
  let renderedHtml = "";
  let renderCalls = 0;
  const basePathIds: string[] = [];
  try {
    await withPlanloftHome(home, async () => {
      saveConfig({
        ...config(),
        defaultTtlDays: 7,
        github: { repo: "plans", token: "publication-secret" },
        giscus: {
          repo: "owner/plans",
          repoId: "repo-id",
          category: "Reviews",
          categoryId: "category-id",
        },
      });
      const manifest: Manifest = {
        version: 1,
        deploys: [{
          id: "stable-id",
          project: "project",
          slug: "roadmap",
          title: "Old title",
          kind: "plan",
          createdAt: "2035-01-01T00:00:00.000Z",
          expiresAt: "2035-01-08T00:00:00.000Z",
        }],
      };
      const host: HostAdapter = {
        name: "memory-github",
        basePath: (id, cfg) => {
          basePathIds.push(id);
          return `/${cfg.github?.repo}/p/${id}/`;
        },
        deploy: async (input) => {
          assert.deepEqual(input.authentication, { user: "owner", token: "publication-secret" });
          const expiresAt = input.updateManifest(manifest, input.id);
          assert.equal(manifest.deploys[0]?.id, "stable-id");
          renderCalls += 1;
          renderedDirectory = input.render("stable-id");
          renderedHtml = fs.readFileSync(path.join(renderedDirectory, "index.html"), "utf8");
          return { url: "https://example.test/stable-id/", expiresAt: "wrong-adapter-expiry" };
        },
      };
      const publication = createPublicationModule({
        configuration: createPlanloftConfiguration(),
        clock: () => new Date("2035-02-03T04:05:06.000Z"),
        id: () => "candidate-id",
        host,
        auth: {
          runGh: (args) => {
            if (args[0] === "api") return JSON.stringify({ login: "owner" });
            throw new Error("gh unavailable");
          },
          interactive: false,
        },
      });
      const document: DocMeta = {
        slug: "roadmap",
        title: "Roadmap",
        kind: "plan",
        project: "project",
        format: "md",
        file: source,
        updatedAt: "2035-02-03T04:05:06.000Z",
      };
      const prepared = publication.prepare(document, { comments: true });
      const result = await publication.publish(document, prepared);
      assert.equal(result.expiresAt, "2035-02-10T04:05:06.000Z");
      assert.equal(manifest.deploys[0]?.expiresAt, result.expiresAt);
      assert.match(result.warnings.join("\n"), /repository is public/i);
      assert.doesNotMatch(JSON.stringify(result), /publication-secret/);
      assert.equal(renderCalls, 1);
      assert.deepEqual(basePathIds, ["stable-id"]);
      assert.equal(fs.existsSync(renderedDirectory), false);

      assert.match(renderedHtml, /planloft-theme-toggle/);
      assert.match(renderedHtml, /prefers-color-scheme/);
      assert.match(renderedHtml, /giscus\.app\/client\.js/);
      assert.match(renderedHtml, /noindex, nofollow/);
    });
  } finally {
    if (renderedDirectory) fs.rmSync(renderedDirectory, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("real-host publication cleans its one final-id artifact when the adapter fails", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "planloft-publication-cleanup-test-"));
  const source = path.join(home, "failure.md");
  fs.writeFileSync(source, "# Failure\n");
  let renderedDirectory = "";
  let renderCalls = 0;
  try {
    await withPlanloftHome(home, async () => {
      saveConfig({ ...config(), github: { token: "cleanup-secret", repo: "plans" } });
      const host: HostAdapter = {
        name: "failing-memory-host",
        basePath: (id) => `/plans/p/${id}/`,
        deploy: async (input) => {
          renderCalls += 1;
          renderedDirectory = input.render("stable-cleanup-id");
          assert.equal(fs.existsSync(path.join(renderedDirectory, "index.html")), true);
          throw new Error("simulated adapter failure");
        },
      };
      const publication = createPublicationModule({
        configuration: createPlanloftConfiguration(),
        clock: () => new Date("2037-03-04T05:06:07.000Z"),
        id: () => "unused-candidate-id",
        host,
        auth: {
          runGh: (args) => {
            if (args[0] === "api") return JSON.stringify({ login: "owner" });
            throw new Error("gh unavailable");
          },
          interactive: false,
        },
      });
      const document: DocMeta = {
        slug: "failure",
        title: "Failure",
        kind: "plan",
        project: "project",
        format: "md",
        file: source,
        updatedAt: "2037-03-04T05:06:07.000Z",
      };
      const prepared = publication.prepare(document);
      await assert.rejects(publication.publish(document, prepared), /simulated adapter failure/);
    });
    assert.equal(renderCalls, 1);
    assert.ok(renderedDirectory);
    assert.equal(fs.existsSync(renderedDirectory), false);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

function config(overrides: Partial<Config> = {}): Config {
  return {
    version: 1,
    theme: "minimal",
    defaultTtlDays: 30,
    projects: {},
    ...overrides,
  };
}

function publicationInput(ttlDays: number, now: Date) {
  return {
    id: "candidate",
    dist: "/tmp/dist",
    ttlDays,
    now,
    document: { project: "project", slug: "roadmap", title: "Roadmap", kind: "plan" },
  };
}
