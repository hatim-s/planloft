---
name: write-plan
description: >-
  Persist a substantial implementation/design plan to the planloft global store.
  Use this WHENEVER you finish producing a real plan — especially right after exiting
  plan mode, or when the user asks you to plan a feature, migration, refactor, or
  architecture. Skip it for trivial one-step throwaway plans.
when_to_use: "After exiting plan mode; when asked to plan a feature/migration/refactor/architecture."
allowed-tools: Bash(planloft:*) Write Read
---

# Write the plan to planloft

You have just produced a plan. Persist it to the planloft global store so the user can
theme, copy, and deploy it. Do this **without asking** — it is the whole point of the
plugin.

## Step 1 — Resolve the target path, theme, and template

Derive a short kebab-case `slug` from the plan's topic (e.g. `auth-refactor`) and a
human `title`. Then run:

```!
planloft resolve --kind plan --slug "SLUG_HERE" --title "TITLE_HERE"
```

This prints JSON:

```jsonc
{
  "path":     "/Users/you/.planloft/docs/<project>/<slug>.md",  // where to Write
  "kind":     "plan",               // include this in frontmatter
  "format":   "md",                 // md | html — author in THIS format
  "theme":    "editorial",          // resolved theme (plan > project > global)
  "template": "…authoring guidance…" // how this theme wants the plan written
}
```

> For other durable docs (ADR, review, research, report, note), use the **save-doc**
> skill instead — same mechanism with `--kind <kind>`.

> Replace `SLUG_HERE` / `TITLE_HERE` with the actual values before running.

## Step 2 — Write the plan

`Write` the plan to the exact `path` returned above, authored in the returned `format`
and following the returned `theme` `template` guidance:

- **minimal** — terse bullets, no filler, black-and-white structure.
- **detailed** — full technical sections: Context, Approach, Steps, Risks, Open
  questions.
- **editorial** — narrative prose, a TL;DR, callouts; readable like an article.

Start the file with YAML frontmatter (the hook fills in anything you omit):

```yaml
---
title: <title>
slug: <slug>
kind: plan
theme: <theme>        # optional per-plan override
status: active
---
```

## Step 3 — Done

Do **not** copy it into the repo or deploy it unless the user asks. Tell the user the
plan was saved and mention they can `/planloft-copy` it into the repo or
`/planloft-deploy` it for review.

If `planloft resolve` fails (CLI not found), tell the user to check the planloft install
— do not write the plan to a guessed path.
