import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createPlanloftApplication } from "../src/application.js";
import { DEFAULT_CONFIG, saveConfig } from "../src/configuration.js";
import { builtinThemesDir, withPlanloftHome } from "../src/core/paths.js";
import { projectKey } from "../src/core/project.js";

test("a random global default picks a bundled theme once per stored document", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "planloft-random-theme-"));
  const home = path.join(root, "home");
  const source = path.join(root, "plan.html");
  fs.writeFileSync(source, "<!doctype html><title>A plan</title><main>Ship it</main>");
  const deployments: string[] = [];
  const app = createPlanloftApplication({
    cwd: root,
    planloftHome: home,
    id: () => "random-theme-test",
    openUrl: () => true,
    publicationAdapter: {
      basePath: () => "/plans/random-theme-test/",
      deploy: async ({ dist }) => {
        deployments.push(fs.readFileSync(path.join(dist, "index.html"), "utf8"));
        return { url: "https://example.test/plan", expiresAt: "2031-03-11T05:06:07.000Z" };
      },
    },
  });

  try {
    withPlanloftHome(home, () => saveConfig({ ...DEFAULT_CONFIG, theme: "random" }));
    const { context } = await app.resolve({ format: "html", slug: "plan" });
    assert.ok(context.theme !== "random");
    assert.ok(fs.existsSync(path.join(builtinThemesDir(), context.theme, "style.css")));
    assert.match(context.themeCss, /--planloft-paper/);
    assert.equal((await app.resolve({ format: "html", theme: "navy-amber" })).context.theme, "navy-amber");

    const published = await app.publish(source, { trustedHtml: true });
    const theme = published.document.theme;
    assert.ok(theme && theme !== "random");
    assert.ok(fs.existsSync(path.join(builtinThemesDir(), theme, "style.css")));
    assert.equal((await app.resolve({ format: "html", slug: published.document.slug })).context.theme, theme);
    await app.deploy(published.document.slug);
    assert.equal(deployments[0], deployments[1]);
    const hoisted = await app.hoist(source, { trustedHtml: true });
    assert.equal(hoisted.document.theme, theme);

    withPlanloftHome(home, () => saveConfig({
      ...DEFAULT_CONFIG,
      theme: "random",
      projects: { [projectKey(root).key]: { theme: "editorial" } },
    }));
    assert.equal((await app.resolve({ format: "html", slug: "another" })).context.theme, "editorial");
    const explicit = await app.hoist(source, { trustedHtml: true, theme: "navy-amber" });
    assert.equal(explicit.document.theme, "navy-amber");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
