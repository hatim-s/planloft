# planloft

> Hoist your Claude Code plans into a global, themed, shareable store.

planloft is a Claude Code **plugin + CLI**. When your agent writes a plan, planloft
captures it into a per-project global store, lets you theme it (minimal / detailed /
editorial), copy it into your repo, and deploy it as a shareable review link that
auto-expires.

## What it does

- **Auto-capture** — a bundled skill tells the agent to persist substantial plans; a
  hook backstops it. Plans land in `~/.planloft/plans/<project>/`.
- **Organized by project** — keyed by git remote (fallback: path hash), so plans
  follow the repo, not the folder.
- **Themed** — every plan has a look *and* feel. `minimal`, `detailed`, `editorial`
  built in; drop your own in `~/.planloft/themes/`.
- **1-click copy** — `/planloft-copy` drops the plan into `./.planloft/plans/` in your
  repo, committed alongside code.
- **1-click deploy** — `/planloft-deploy` builds a themed static site and publishes it:
  - **GitHub Pages** (default) — free, auto-expires after 30 days (`--ttl 90`, redeploy
    bumps expiry).
  - **Vercel** (`--host vercel`) — permanent, opt-in.

## Install

```bash
# as a Claude Code plugin (recommended — auto-wires skill, hook, commands)
/plugin install planloft

# or the CLI standalone
pnpm add -g planloft
```

Zero-config: it works on install. Config is written on your first plan; connect flows
(`gh` / `vercel`) prompt on your first deploy.

## CLI

```
planloft list                 # plans grouped by project
planloft preview <slug>       # themed preview in your browser
planloft copy [slug]          # copy raw plan into ./.planloft/plans/
planloft deploy [slug]        # build + publish; prints the link
planloft rm <slug>            # remove a plan from the store
planloft config               # open/edit global config
planloft init                 # optional: set theme/format, verify hosts
```

## Config (`~/.planloft/config.json`)

```jsonc
{
  "theme": "minimal",          // minimal | detailed | editorial | <custom>
  "planFormat": "md",          // md | html
  "defaultTtlDays": 30,
  "projects": {                // per-project overrides (theme, etc.)
    "github.com/you/subslot": { "theme": "editorial" }
  }
}
```

Theme resolution: **plan frontmatter > project override > global default**.

## Design

Architecture decisions are recorded in [`docs/adr/`](./docs/adr/). Start with
[ADR-0001](./docs/adr/0001-planloft-architecture.md).

## Status

Early scaffold (v0.0.1). See ADR-0001 for the resolved design and the deferred list.
