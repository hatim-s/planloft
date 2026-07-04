# planloft

> Hoist your agent-written plans and docs into a global, themed, shareable store.

planloft is a Claude Code / Codex **plugin + CLI**. When your agent writes a plan, planloft
captures it into a per-project global store, lets you theme it (minimal / detailed /
editorial), copy it into your repo, and deploy it as a shareable review link that
auto-expires.

## What it does

- **Auto-capture** — a bundled skill tells the agent to persist substantial plans; hooks
  backstop Claude plan-mode exit and Codex plan-mode turn stop. Plans and durable docs
  land in `~/.planloft/docs/<project>/`.
- **Organized by project** — keyed by git remote (fallback: path hash), so plans
  follow the repo, not the folder.
- **Themed** — every plan has a look *and* feel. `minimal`, `detailed`, `editorial`
  built in; drop your own in `~/.planloft/themes/`.
- **1-click copy** — `/planloft-copy` drops the plan into `./.planloft/plans/` in your
  repo, committed alongside code.
- **1-click deploy** — `/planloft-deploy` builds a themed static site and publishes it to
  **GitHub Pages** — free, served at an unguessable URL, auto-expires after 30 days
  (`--ttl 90`, redeploy bumps expiry).

## Install

```bash
# as a Claude Code plugin (recommended — auto-wires skill, hook, commands)
/plugin install planloft

# or the CLI standalone
pnpm add -g planloft
```

Codex support is shipped through `.codex-plugin/plugin.json`, the bundled `skills/`
directory, and `hooks/hooks.json`. Codex uses skills for the same flows: `write-plan`,
`save-doc`, `planloft-preview`, `planloft-copy`, and `planloft-deploy`.

Zero-config: it works on install. Config is written on your first plan; the GitHub
connect flow (`gh`) prompts on your first deploy.

## CLI

```
planloft list                 # docs grouped by project
planloft preview <slug>       # themed preview in your browser
planloft copy [slug]          # copy raw doc into ./.planloft/plans/
planloft deploy [slug]        # build + publish; prints the link
planloft rm <slug>            # remove a doc from the store
planloft config               # open/edit global config
planloft init                 # optional: set theme/format, verify GitHub
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

## Current scope

planloft currently supports the local doc store, themed preview, copy-to-repo, Claude
Code and Codex plugin wiring, and GitHub Pages deploys. Saved docs stay local until you
copy or deploy them. Deployed review links are public-by-link, marked `noindex`, and
expire through the GitHub Pages cleanup workflow.
