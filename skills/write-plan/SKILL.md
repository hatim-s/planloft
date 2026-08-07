---
name: write-plan
description: >-
  Author and persist a substantial, standalone Planloft implementation, migration,
  refactor, architecture, or design plan. Use after plan-mode completion with durable
  content or when the user explicitly asks to save a plan with Planloft. Skip trivial
  one-step work, conversational or throwaway output, and requests that only render,
  hoist, preview, copy, or deploy an existing source.
---

# Write a Planloft plan

Persist the substantial plan directly. Keep it reviewable without conversation history.

## Check the prerequisite

This skill requires the separately installed Planloft CLI. Skill-only installation does
not install the executable, hooks, themes, runtime assets, or plugin metadata.

Run `command -v planloft` before resolving. If it is missing, stop and report this
actionable message:

> Planloft CLI is required by the write-plan skill. Install it with
> `npm install -g planloft`, `pnpm add -g planloft`, or `bun add -g planloft`, then
> retry in a new agent session.

## Resolve the target

Derive a short kebab-case slug and a human title. Run this exact command with real
values:

```!
planloft resolve --kind plan --slug "<slug>" --title "<title>"
```

Use the returned path. Never guess or synthesize a store path. If the command fails,
report the install problem instead of writing elsewhere.

## Author and persist

Author Markdown at the returned path and follow the returned theme guidance. Start with
complete frontmatter:

```yaml
---
title: <title>
slug: <slug>
kind: plan
status: active
---
```

Name concrete files, modules, commands, dependencies, risks, and unresolved decisions.
Let Planloft render the HTML artifact; do not manually author generated HTML.

Treat light and dark presentation as mandatory. Do not embed one-theme colors or
presentation markup in the Markdown. Planloft output must expose a theme toggle at the
top and must initially honor `prefers-color-scheme`; follow any custom theme guidance
only when it preserves both appearances.

## Discover other operations

<!-- planloft:command-knowledge:start -->
Run `planloft help` to discover all operations.

Common next actions:
- `planloft render <input>` produces HTML without storing or publishing.
- `planloft preview [slug]` opens a stored plan locally.
- `planloft copy [slug]` copies raw source into the repository.
- `planloft deploy [slug]` explicitly publishes a stored plan.
- `planloft hoist <input>` stores another Markdown, JSON, or trusted HTML document.
<!-- planloft:command-knowledge:end -->

Never deploy unless the user explicitly requests publication. GitHub Pages publication
uses a public, enumerable repository and manifest.

## Finish

Report the exact saved path. Do not preview, copy, render, hoist, or deploy unless the
user also requests that action.
