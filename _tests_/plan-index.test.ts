import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

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

const templatesDir = fileURLToPath(new URL("../templates/hosting/", import.meta.url));
const planIndexesUrl = new URL("../templates/hosting/update-indexes.mjs", import.meta.url).href;
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

test("README and index symlinks cannot be read or overwritten", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "planloft-index-symlink-test-"));
  const root = path.join(temp, "site");
  const readmeSentinel = path.join(temp, "external-readme.md");
  const htmlSentinel = path.join(temp, "external-index.html");
  fs.mkdirSync(path.join(root, "public"), { recursive: true });
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
    assert.equal(fs.existsSync(path.join(root, "public", "index.html")), false);

    fs.unlinkSync(path.join(root, "README.md"));
    fs.writeFileSync(path.join(root, "README.md"), "# Plans\n");
    fs.symlinkSync(htmlSentinel, path.join(root, "public", "index.html"));
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
  fs.mkdirSync(path.join(root, "public"), { recursive: true });
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
    id: "future-plan", slug: "future-plan",
    expiresAt: "2026-06-01T12:00:00.001Z",
  });
  const permanent = deployment({ id: "permanent-plan" });

  try {
    writeDeployments(root, [before, boundary, after, permanent]);
    const originalReadme = "# Plans\n\nKeep this line.\n";
    const originalHtml = "old index\n";
    fs.writeFileSync(path.join(root, "README.md"), originalReadme);
    fs.writeFileSync(path.join(root, "public", "index.html"), originalHtml);

    const prepared = planIndexes.preparePlanIndexes(root, { now, pagesBaseUrl: "https://example.test" });
    assert.equal(prepared.count, 2);
    assert.match(prepared.readme, /future-plan/);
    assert.doesNotMatch(prepared.readme, /expired-before|boundary-plan/);
    assert.match(prepared.html, /future-plan/);
    assert.doesNotMatch(prepared.html, /expired-before|boundary-plan/);
    assert.equal(fs.readFileSync(path.join(root, "README.md"), "utf8"), originalReadme);
    assert.equal(fs.readFileSync(path.join(root, "public", "index.html"), "utf8"), originalHtml);

    writeDeployments(root, [after, permanent]);
    fs.mkdirSync(path.join(root, "p", "expired-before"), { recursive: true });
    fs.mkdirSync(path.join(root, "p", "boundary-plan"), { recursive: true });
    fs.rmSync(path.join(root, "p", "expired-before"), { recursive: true });
    fs.rmSync(path.join(root, "p", "boundary-plan"), { recursive: true });
    planIndexes.writePlanIndexes(root, prepared);

    assert.equal(fs.readFileSync(path.join(root, "README.md"), "utf8"), prepared.readme);
    assert.equal(fs.readFileSync(path.join(root, "public", "index.html"), "utf8"), prepared.html);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("CLI accepts an injected ISO clock with the pages base URL", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "planloft-index-cli-clock-test-"));
  const root = path.join(temp, "site");
  fs.mkdirSync(path.join(root, "public"), { recursive: true });
  const now = "2026-06-01T12:00:00.000Z";

  try {
    fs.copyFileSync(
      path.join(templatesDir, "update-indexes.mjs"),
      path.join(root, "update-indexes.mjs"),
    );
    writeDeployments(root, [
      deployment({ id: "boundary-plan", expiresAt: now }),
      deployment({ id: "future-plan", slug: "future-plan", expiresAt: "2026-06-01T12:00:00.001Z" }),
    ]);
    execFileSync(
      process.execPath,
      ["update-indexes.mjs", "https://example.test/plans", "--now", now],
      { cwd: root, stdio: "ignore" },
    );

    const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
    assert.match(readme, /future-plan/);
    assert.doesNotMatch(readme, /boundary-plan/);
    assert.match(readme, /https:\/\/example\.test\/plans\/future-plan\//);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("managed README markers replace only their exact unique block", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "planloft-index-readme-marker-test-"));
  const root = path.join(temp, "site");
  fs.mkdirSync(path.join(root, "public"), { recursive: true });

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
  fs.mkdirSync(path.join(root, "public"), { recursive: true });

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
  fs.mkdirSync(path.join(root, "public"), { recursive: true });
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
      fs.writeFileSync(path.join(root, "public", "index.html"), "keep this index\n");
      assert.throws(() => updateIndexes(root), testCase.error);
      assert.equal(fs.readFileSync(path.join(root, "README.md"), "utf8"), testCase.readme);
      assert.equal(fs.readFileSync(path.join(root, "public", "index.html"), "utf8"), "keep this index\n");
    }
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("root plan index has accessible semantics and overflow-safe responsive links", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "planloft-index-semantics-test-"));
  const root = path.join(temp, "site");
  fs.mkdirSync(path.join(root, "public"), { recursive: true });
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
