# ADR-0001 — planloft foundational architecture

- **Status**: Accepted as amended by ADR-0008
- **Date**: 2026-07-02
- **Context**: Initial design of planloft, resolved in a single interactive design
  session. The decisions below (D1–D26) were made together and are interdependent;
  they are recorded as one foundational ADR rather than 26 separate files.

---

## Summary

planloft is a Claude Code **plugin + bundled CLI** that hoists agent-written plans into
a global, per-project store (`~/.planloft/`), applies a configurable theme (look *and*
feel), and publishes single plans as shareable, auto-expiring review links. The default
host is **GitHub Pages** (free, TTL'd); **Vercel** is an opt-in permanent host.

---

## Decision log

### D1 — Form factor: plugin + bundled CLI
**Decision.** Ship as a Claude Code plugin (marketplace) that auto-wires the skill,
hook, and slash commands, AND bundles a Node CLI (`planloft`) for hoist/copy/render/
deploy. Distribute via both the plugin marketplace and npm.
**Consequences.** One install wires everything; the same logic is callable from the
terminal. Two distribution channels to maintain.
**Rejected.** Pure npm CLI (manual skill install); plugin-only (no reusable CLI).

### D2 — Capture model: write-direct + hook normalize
**Decision.** The skill gives the agent the resolved global path; the agent writes the
plan straight into `~/.planloft/plans/<project>/`. A `PostToolUse` hook then normalizes
it (injects frontmatter, updates the index). The global store is canonical; the repo
stays clean.
**Consequences.** Repo is untouched by default; copy-to-repo is a separate explicit
action. Requires reliable project-key resolution at write time.
**Rejected.** Write-local-then-hoist (makes copy-to-repo redundant); hook-captures-
ExitPlanMode-text (harder to apply rich theming at write time).

### D3 — Global home: `~/.planloft/`
**Decision.** The store lives at `~/.planloft/`, **not** under `~/.claude/`.
**Layout.**
```
~/.planloft/
  config.json          # global config (theme, planFormat, defaultTtlDays, projects{})
  index.json           # project-key -> { dir, plans[] } mapping + plan metadata
  plans/<project>/<slug>.md|html
  themes/<name>/       # user-authored themes
  renderer/            # bundled prebuilt Astro renderer (see D25)
```
**Rejected.** Nesting under `~/.claude/` (pollutes Claude's own config namespace).

### D4 — Project key: git remote, fallback path-hash
**Decision.** Key a project by its normalized git remote origin
(e.g. `github.com/you/subslot`). No remote → short hash of the absolute repo-root path.
The folder name under `plans/` is a human label; the canonical key lives in `index.json`.
**Consequences.** Survives folder rename/move; dedupes clones of the same repo. Two
machines with the same remote share a key (good for the git-ready sync story, D26).
**Rejected.** Repo-root path only (breaks on move); folder basename only (collisions).

### D5 — Plan lifecycle: slug overwrite (v1), versioning later
**Decision.** One file per topic slug; re-planning the same topic **overwrites** it in
v1. Frontmatter and directory layout are kept extensible so immutable history /
versioning can be added later without migration.
**Consequences.** No clutter now; revision history is lost until versioning ships.
**Rejected.** Timestamped immutable history (deferred, not rejected); numbered sequence.

### D6 — Skill trigger: auto on plan, hook backstop
**Decision.** The skill description is tuned to fire whenever the agent produces a
substantial plan (especially on exiting plan mode). A hook on `ExitPlanMode` backstops:
if no plan file was written, it nudges/ensures the write.
**Consequences.** Truly batteries-included; zero user effort. Relies partly on agent
judgment for "substantial", backstopped deterministically.
**Rejected.** Explicit command/phrase only (less automatic); hook-forced on every
ExitPlanMode (saves throwaway plans, no judgment).

### D7 — Theme = authoring template + visual skin
**Decision.** A theme bundles (a) an **authoring template** + writing guidance injected
into the skill, so the agent writes the markdown/HTML in that style, AND (b) a **visual
skin** (Astro layout + CSS) for the rendered output. Look *and* feel.
**Rejected.** Visual-skin-only (content wouldn't change); authoring-only (no visual
polish).

### D8 — Theme resolution order: plan > project > global
**Decision.** Themes can be set at three levels. A per-plan override (frontmatter) beats
a per-project override (`config.projects[key]`) beats the global default.
**Rejected.** Global-only; global+project (no per-plan control).

### D9 — Plan format toggle: `planFormat: md | html`
**Decision.** Global config selects whether plans are authored/stored as Markdown or as
self-contained HTML. The skill's authoring template adapts to the format.
**Consequences.** The assembler (D10) must handle both: convert md→html, or wrap/
pass-through authored html.

### D10 — Assembler: bundled Astro static template
> **Superseded by [ADR-0003](./0003-marked-renderer.md)** — replaced by a minimal
> in-process `marked` renderer.

**Decision.** A prebuilt Astro site (bundled) is the assembler. The CLI feeds it the
plan(s) + resolved theme and runs `astro build` to produce static HTML. Themes are
swappable Astro layouts + CSS. Also builds the **local** gallery/index for browsing.
**Consequences.** Heavier than a hand-rolled renderer; build step always runs (even for
html-format plans, which pass through Astro to get the wrapper/gallery). See D25 for how
the heavy runtime is provisioned.
**Rejected.** Minimal custom md→html (less DX/components); Next static export (heaviest).

### D11 — Hosting: GitHub Pages (default, TTL) + Vercel (permanent), pluggable
**Decision.** Ship two host adapters in v1 behind a pluggable `HostAdapter` interface:
- **GitHub Pages** — default, free, auto-expiring (D15, D20).
- **Vercel** — opt-in (`--host vercel`), **permanent** (no TTL). This deliberately
  sidesteps Vercel's lack of native deployment expiry: Vercel *is* the "keep it" option.
**Rejected.** Central managed service we operate (avoided infra/abuse liability);
GitHub-only with no adapter seam (refactor cost to add hosts later).

### D12 — GitHub auth: `gh` CLI primary, PAT fallback
**Decision.** Use the `gh` CLI if installed + authenticated (repo create, Pages enable
via API). Otherwise prompt for a PAT (repo + pages scope) stored in `config.json`. No
OAuth app to operate.
**Rejected.** OAuth device flow (requires operating a GitHub OAuth app); PAT-only
(manual token friction).

### D13 — Vercel auth: `vercel` CLI primary, token fallback
**Decision.** Mirror D12. Use the `vercel` CLI if logged in
(`vercel deploy --prebuilt dist/`); otherwise prompt for a Vercel access token.
**Rejected.** Token-only; Vercel OAuth integration (requires operating an integration).

### D14 — Deploy unit: one plan per deploy
**Decision.** Each deploy publishes a single plan as a standalone themed site → one
shareable link. (The gallery/index is for *local* browsing of the store, not for
deploys.)
**Rejected.** Whole-project gallery per deploy; selectable set (adds a selection step to
the 1-click flow).

### D15 — GitHub Pages topology: one repo, folder per plan
**Decision.** One dedicated **public** repo per user: `user/planloft-plans`. Each deploy
is a folder `/p/<shortid>/` containing the built site. A root `manifest.json` tracks
`{ id, project, plan, createdAt, expiresAt }`. **One** scheduled GitHub Action (daily
cron) prunes folders past `expiresAt`, updates the manifest, and commits — Pages
redeploys automatically. Redeploy = re-add the folder / bump expiry.
URL: `user.github.io/planloft-plans/p/<shortid>/`.
**Rejected.** One repo per plan (spams repo list, per-repo Action overhead);
`user.github.io` root repo (collides with an existing personal site).

### D16 — Control surface: slash commands + CLI (v1); dashboard (v2)
**Decision.** v1 "1-click" = Claude Code slash commands with no required args
(`/planloft-copy`, `/planloft-deploy`, `/planloft-preview`) that infer the current
project + latest plan, backed by the CLI. A local web dashboard (`planloft ui`) is
deferred to v2.
**Rejected.** Dashboard in v1 (large scope up front).

### D17 — Copy-to-repo: raw source → `./.planloft/plans/`
**Decision.** `/planloft-copy` copies the **raw** plan source (`.md`/`.html` per
`planFormat`) into `repo_root/.planloft/plans/<slug>`. Meant to be committed alongside
code (diff-friendly, portable). Latest plan inferred; `copy <slug>` to pick.
**Rejected.** `./docs/plans/` or `./plans/` (chose the `.planloft/` convention for
consistency with the global home); rendered-output copy (odd to commit generated HTML).

### D18 — Themes shipped in v1 + pluggable
**Decision.** Ship three built-in themes — `minimal` (mono, b&w, terse), `detailed`
(structured technical sections), `editorial` (prose/magazine). The system is pluggable:
a user drops `~/.planloft/themes/<name>/{template.md, layout.astro, style.css}` to add
their own.
**Rejected.** Three fixed (no custom); start-with-one (under-delivers on the look/feel
pitch).

### D19 — Review page: read-only (v1), giscus opt-in
**Decision.** The deployed page is static and read-only by default (themed, with a
copy/permalink affordance). An opt-in `--comments` flag wires **giscus** (GitHub
Discussions-backed comments) — reviewers comment with their GitHub account, no backend.
**Rejected.** Strictly read-only forever; comments on by default (forces Discussions
setup on every plan).

### D20 — Expiry: default 30 days, `--ttl` override, redeploy bumps
**Decision.** `config.defaultTtlDays = 30`. Per-deploy override `--ttl <N>` (e.g. 90).
Redeploy resets `expiresAt` from today. The daily Action (D15) prunes expired folders.
Vercel deploys are permanent (no TTL). Want permanence on the free path? Redeploy, or
use Vercel.
**Rejected.** Default 90; prompt-each-deploy (breaks the frictionless flow).

### D21 — Link privacy: unguessable id + `noindex`
**Decision.** Deploy URLs use an unguessable ~10-char base62 id; pages carry
`<meta name="robots" content="noindex">`; there is no root gallery listing (root = a
bare landing page). **Caveat (documented):** the GitHub repo itself is public, so
someone browsing `github.com/user/planloft-plans` can enumerate all plan folders.
Privacy here is *obscurity*, not access control. For sensitive plans, keep them local or
use a private Vercel deploy.
**Rejected.** Client-side passphrase gate (security theater, bypassable);
warn-and-confirm each deploy (friction).

### D22 — Implementation language: Node + TypeScript
**Decision.** The CLI is Node + TypeScript (mandated by the Astro renderer, npm
distribution, and `gh`/`vercel` CLI interop). Not treated as an open question.

### D23 — Onboarding: zero-config, lazy prompts
**Decision.** The plugin works immediately on install (skill + hook active). Defaults
(`theme=minimal`, `planFormat=md`, `defaultTtlDays=30`) are written to `config.json` on
the first captured plan. Connect flows (`gh`/`vercel`) prompt only on the first deploy.
`planloft init` exists but is **optional** (opens config for editing).
**Rejected.** Explicit `init` required (gate before value); install-time wizard
(interrupts install, pre-value decisions).

### D24 — Local CLI verb set
**Decision.** v1 ships `list`, `preview <slug>` (local Astro build + open in browser),
`copy`, `deploy`, `rm <slug>`, `config`, `init`. Slash commands wrap copy/deploy/preview.
**Rejected.** Minimal list+deploy only (no local theme preview); filesystem+editor only
(poor discoverability).

### D25 — Renderer runtime: bundle prebuilt
> **Superseded by [ADR-0003](./0003-marked-renderer.md)** — no bundled renderer runtime;
> rendering is in-process (`marked` + `gray-matter`). Eliminates Risk #1 below.

**Decision.** Ship the Astro renderer with its `node_modules` **pre-vendored** in the
published package — no install step at render time, works offline.
**Consequences / risk (see Risks §1).** Native binaries (esbuild, sharp) are
platform-specific and are the main portability risk. **Mitigation:** disable Astro's
`sharp` image service (plans rarely need image optimization) and provide the correct
per-platform `esbuild` binary via a thin `postinstall` shim. The `renderer/node_modules`
is git-ignored in source and produced by `npm run vendor:renderer` at publish time.
**Rejected.** Lazy-install to `~/.planloft/renderer` (first-render cost, but safer for
cross-OS — reconsider if the native-binary mitigation proves fragile); `npx` on demand
(network-dependent, slow repeats).

### D26 — Cross-machine sync: local-only, git-ready
**Decision.** v1 is local only. `~/.planloft/` is structured as a plain directory the
user can `git init` themselves (point at a private repo) for DIY backup/sync. No
built-in sync code. Managed sync deferred.
**Rejected.** Built-in git sync (conflict handling + extra repo + auth now); no
consideration for portability (harder retrofit).

---

## Risks

1. **Bundled `node_modules` cross-OS (D25).** esbuild/sharp are native and
   platform-specific. This is the biggest technical risk. Mitigation in D25; fallback is
   lazy-install per platform.
2. **Public GitHub repo (D21).** Unguessable *page* ids do not hide the fact that the
   `planloft-plans` repo is public and browsable on github.com. Privacy is obscurity.
3. **Auto-capture noise (D6).** Throwaway plans may be persisted. Mitigated by the
   "substantial plan" judgment and slug overwrite (D5).
4. **`gh`/`vercel` CLI dependency (D12/D13).** The smooth path needs these CLIs; the
   PAT/token fallback covers users without them.

## Deferred (non-blocking, implementation-time)

- Exact `index.json` and frontmatter schemas.
- Exact `SKILL.md` wording and hook matcher details.
- Astro per-deploy `base` path handling and `noindex` injection.
- giscus category/repo wiring specifics.
- The pruning GitHub Action YAML.
- Plan versioning / immutable history (D5 extension).
- Managed sync (D26) and the v2 local dashboard (D16).
