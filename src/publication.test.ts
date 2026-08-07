import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { redactConfig } from "./commands/config.js";
import { loadConfig, saveConfig } from "./core/config.js";
import { resolveGiscusConfig } from "./core/giscus.js";
import { parseTtlDays, resolveTtlDays } from "./core/ttl.js";
import type { Config, DocMeta } from "./core/types.js";
import type { DeployInput } from "./hosts/adapter.js";
import {
  discoverGithubCredential,
  GITHUB_AUTH_INVALID,
  GITHUB_AUTH_MISSING,
  GITHUB_AUTH_UNREACHABLE,
  githubPages,
  updateManifestDeployment,
  validateGithubCredential,
  type Manifest,
} from "./hosts/github-pages.js";

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
  for (const invalid of [0, -1, 1.2, Number.NaN, Number.POSITIVE_INFINITY, "0", "-1", "1.2", "3d", "01"]) {
    assert.throws(() => parseTtlDays(invalid), /finite positive integer/);
  }
  assert.equal(resolveTtlDays(undefined, 30), 30);
  assert.equal(resolveTtlDays(7, 30), 7);
  assert.throws(() => resolveTtlDays(undefined, 0), /config\.defaultTtlDays/);
});

test("configuration validates defaultTtlDays and redacts configured credentials", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "planloft-publication-config-"));
  const previousHome = process.env.PLANLOFT_HOME;
  process.env.PLANLOFT_HOME = home;
  try {
    const valid = config({ github: { token: "configured-secret", repo: "plans" } });
    saveConfig(valid);
    assert.equal(loadConfig().defaultTtlDays, 30);
    const printable = JSON.stringify(redactConfig(loadConfig()));
    assert.match(printable, /\[redacted\]/);
    assert.doesNotMatch(printable, /configured-secret/);

    fs.writeFileSync(
      path.join(home, "config.json"),
      JSON.stringify({ ...valid, defaultTtlDays: 0 }),
    );
    assert.throws(() => loadConfig(), /config\.defaultTtlDays must be a finite positive integer/);
    assert.throws(
      () => saveConfig({ ...valid, defaultTtlDays: Number.POSITIVE_INFINITY }),
      /config\.defaultTtlDays must be a finite positive integer/,
    );
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

  const login = await validateGithubCredential(prompted, async () =>
    new Response(JSON.stringify({ login: "hatim-s" }), { status: 200 }),
  );
  assert.equal(login, "hatim-s");

  await assert.rejects(
    validateGithubCredential(prompted, async () => new Response(null, { status: 401 })),
    (error: Error) => {
      assert.match(error.message, new RegExp(`^${GITHUB_AUTH_INVALID}:`));
      assert.doesNotMatch(error.message, /prompt-secret/);
      return true;
    },
  );
  await assert.rejects(
    validateGithubCredential(prompted, async () => {
      throw new Error("network includes prompt-secret");
    }),
    (error: Error) => {
      assert.match(error.message, new RegExp(`^${GITHUB_AUTH_UNREACHABLE}:`));
      assert.doesNotMatch(error.message, /prompt-secret/);
      return true;
    },
  );
});

test("redeploy keeps the stable URL id and moves expiry from the injected clock", () => {
  const manifest: Manifest = { version: 1, deploys: [] };
  const input = deployInput(30);
  const firstExpiry = updateManifestDeployment(
    manifest,
    input,
    "first-id",
    new Date("2026-08-01T00:00:00.000Z"),
  );
  assert.equal(firstExpiry, "2026-08-31T00:00:00.000Z");
  assert.equal(manifest.deploys[0]?.id, "first-id");

  const secondExpiry = updateManifestDeployment(
    manifest,
    input,
    "ignored-new-id",
    new Date("2026-08-08T00:00:00.000Z"),
  );
  assert.equal(secondExpiry, "2026-09-07T00:00:00.000Z");
  assert.equal(manifest.deploys[0]?.id, "first-id");
  assert.equal(manifest.deploys[0]?.createdAt, "2026-08-01T00:00:00.000Z");
});

test("the GitHub adapter rejects invalid TTL before attempting authentication", async () => {
  await assert.rejects(githubPages.deploy(deployInput(0)), /TTL must be a finite positive integer/);
});

function config(overrides: Partial<Config> = {}): Config {
  return {
    theme: "minimal",
    planFormat: "md",
    defaultTtlDays: 30,
    projects: {},
    ...overrides,
  };
}

function deployInput(ttlDays: number): DeployInput {
  const doc: DocMeta = {
    slug: "roadmap",
    title: "Roadmap",
    kind: "plan",
    project: "project",
    format: "md",
    file: "/tmp/roadmap.md",
    updatedAt: "2026-08-01T00:00:00.000Z",
  };
  return { id: "candidate", dist: "/tmp/dist", doc, ttlDays, cfg: config() };
}
