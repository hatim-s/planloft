---
name: save-doc
description: >-
  Persist a durable document the user will want to re-read into the planloft store —
  an ADR, code/design review, research writeup, report, or note. Use this WHENEVER you
  produce a substantial standalone document (not a plan — plans use write-plan), or when
  the user says "save this as an ADR / research doc / report / review", "keep this",
  "add this to planloft". Skip for throwaway or conversational output.
when_to_use: "After producing an ADR, review, research writeup, report, or note worth keeping; or when asked to save/keep a doc."
allowed-tools: Bash(planloft:*) Write Read
---

# Save a document to planloft

You produced a document worth re-reading. Persist it to the project-keyed store so the
user can browse, copy, and deploy it. Do this without ceremony.

## Step 1 — Pick the kind

Choose the `kind` that fits (built-ins, or any custom string):

| kind | for |
|------|-----|
| `adr` | an architecture decision record |
| `review` | a code/design review writeup |
| `research` | a research / investigation writeup |
| `report` | a status/perf/incident report |
| `note` | anything else worth keeping |
| `<custom>` | e.g. `rfc`, `postmortem` — any string works |

(Plans go through the **write-plan** skill, not this one.)

## Step 2 — Resolve the target path

Derive a short kebab-case `slug` and a human `title`, then run:

```!
planloft resolve --kind KIND_HERE --slug "SLUG_HERE" --title "TITLE_HERE"
```

Prints JSON: `{ path, kind, format, theme, template }`.

> Slugs are unique per project (flat store) — pick a distinct slug so you don't clobber
> another doc (e.g. `adr-0003-caching`, not just `caching`).

## Step 3 — Write the document

`Write` the doc to the returned `path`, in the returned `format`, following the `theme`
`template` for voice/structure. Start markdown docs with frontmatter (the hook fills in
anything you omit):

```yaml
---
title: <title>
slug: <slug>
kind: <kind>
status: active
---
```

## Step 4 — Done

Tell the user it was saved and that they can `planloft list --kind <kind>` to find it,
`/planloft-copy` it into the repo, or `/planloft-deploy` it for review. Do not deploy
unless asked.
