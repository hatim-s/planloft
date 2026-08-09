import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (file: string) => fs.readFileSync(path.join(ROOT, file), "utf8");

test("README keeps installation concise and points detailed setup to one guide", () => {
  const readme = read("README.md");
  for (const heading of ["### CLI-only", "### CLI plus `write-plan`"]) {
    assert.ok(readme.includes(heading));
  }
  assert.doesNotMatch(readme, /^### Full plugin$/m);
  assert.doesNotMatch(readme, /codex plugin (?:marketplace|add)/);
  assert.doesNotMatch(readme, /claude plugin (?:marketplace|install)/);
  assert.match(readme, /planloft init/);
  assert.match(readme, /\[Setup\]\(\.\/docs\/setup\.md\)/);
  assert.match(readme, /Full Codex or Claude plugin installation is not currently a\s+supported setup path/);
});

test("setup guide covers human, agent, and CI setup without plugin recipes", () => {
  const setup = read("docs/setup.md");
  for (const heading of ["## Humans", "## Agents", "## CI", "## Verify"]) {
    assert.ok(setup.includes(heading));
  }
  for (const agent of ["codex", "claude-code"]) {
    const base = `npx skills add hatim-s/planloft --skill write-plan`;
    assert.ok(setup.includes(`${base} -a ${agent}`));
    assert.ok(setup.includes(`${base} -g -a ${agent}`));
  }
  assert.match(setup, /planloft init/);
  assert.match(setup, /Full\s+Codex and Claude plugin installation is not a supported setup path/);
  assert.doesNotMatch(setup, /codex plugin (?:marketplace|add)/);
  assert.doesNotMatch(setup, /claude plugin (?:marketplace|install)/);
});

test("write-plan permanently requires two-theme documents with top-toggle and system fallbacks", () => {
  const skill = read("skills/write-plan/SKILL.md");
  assert.match(skill, /mandatory for every authored or rendered plan\s+document/);
  assert.match(skill, /theme toggle at the very top/);
  assert.match(skill, /accessible theme toggle\s+at the very top/);
  assert.match(skill, /prefers-color-scheme/);
  assert.match(skill, /color-scheme: light dark/);
  assert.match(skill, /@media \(prefers-color-scheme: dark\)/);
  assert.match(skill, /Markdown renderer-neutral/);
  assert.match(skill, /Never ship a plan document that works in only one theme/);
  assert.match(skill, /Skill-only installation does not install the executable/);
  assert.match(skill, /Never deploy unless the user explicitly requests publication/);
});

test("consumer surfaces expose exactly one skill and no retired aliases", () => {
  const skillDirectories = fs
    .readdirSync(path.join(ROOT, "skills"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  assert.deepEqual(skillDirectories, ["write-plan"]);

  const commands = path.join(ROOT, "commands");
  assert.ok(!fs.existsSync(commands) || fs.readdirSync(commands).length === 0);
  const consumerText = [
    "README.md",
    "skills/write-plan/SKILL.md",
    ".codex-plugin/plugin.json",
    ".claude-plugin/plugin.json",
  ].map(read).join("\n");
  for (const retired of ["save-doc", "planloft-preview", "planloft-copy", "planloft-deploy"]) {
    assert.doesNotMatch(consumerText, new RegExp(retired));
  }
});

test("migration guide names every breaking installation and runtime contract", () => {
  const migration = read("docs/installation-migration.md");
  for (const retired of ["save-doc", "planloft-preview", "planloft-copy", "planloft-deploy"]) {
    assert.match(migration, new RegExp(`(?:skill|skills|names).*${retired}`, "s"));
  }
  for (const alias of ["/planloft-preview", "/planloft-copy", "/planloft-deploy"]) {
    assert.ok(migration.includes(alias));
  }
  for (const replacement of [
    "planloft hoist <input>",
    "planloft preview [slug]",
    "planloft copy [slug]",
    "planloft deploy [slug]",
  ]) assert.ok(migration.includes(replacement));
  for (const contract of [
    "Markdown-only",
    "strict version-1",
    "finite positive integers",
    "public",
    "noindex",
    "GitHub Discussions",
    "giscus.repoId",
    "createPlanloftApplication()",
    "ingestDocument",
    "hoistDocument",
    "renderDocument",
  ]) assert.ok(migration.includes(contract), `migration is missing ${contract}`);
  assert.match(migration, /without wrappers/);
  assert.match(migration, /rather than adding\s+backward-compatibility shims/);
});
