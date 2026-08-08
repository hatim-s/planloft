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

Run the bundled `scripts/resolve-planloft-command.sh` from this skill directory before
resolving and capture the executable path it prints. A skill-only install requires a
separately installed Planloft CLI. A full-plugin install instead resolves the packaged
`bin/planloft` bridge without adding a global executable to `PATH`.

```sh
PLANLOFT_COMMAND="$(./scripts/resolve-planloft-command.sh)"
```

If the resolver exits non-zero, stop and relay its actionable installation message.
Skill-only installation does not install the executable, hooks, themes, runtime assets,
or plugin metadata.

## Resolve the target

Derive a short kebab-case slug and a human title. Run this exact command with real
values:

```!
"$PLANLOFT_COMMAND" resolve --kind plan --slug "<slug>" --title "<title>"
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

## Design for both light and dark

Treat dual-theme presentation as mandatory for every authored or rendered plan
document:

- Keep Markdown renderer-neutral. Do not hardcode single-theme-only colors or add
  generated presentation markup to the source.
- When a renderer or theme provider exists, use its light/dark toggle and system-theme
  behavior. Planloft's renderer puts an accessible theme toggle at the very top and
  initially honors the browser's `prefers-color-scheme` setting.
- When producing standalone HTML outside that renderer, put an accessible theme toggle
  at the very top and also implement a `prefers-color-scheme` system fallback.
- When the output cannot support a toggle or theme provider, still honor the browser or
  operating system preference with `color-scheme: light dark` and
  `@media (prefers-color-scheme: dark)`.

Never ship a plan document that works in only one theme. Follow custom theme guidance
only when it preserves both appearances.

## Discover other operations

<!-- planloft:command-knowledge:start -->
Run `"$PLANLOFT_COMMAND" help` to discover all operations.

Common next actions:
- `"$PLANLOFT_COMMAND" render <input>` produces HTML without storing or publishing.
- `"$PLANLOFT_COMMAND" preview [slug]` opens a stored plan locally.
- `"$PLANLOFT_COMMAND" copy [slug]` copies raw source into the repository.
- `"$PLANLOFT_COMMAND" deploy [slug]` explicitly publishes a stored plan.
- `"$PLANLOFT_COMMAND" hoist <input>` stores another Markdown, JSON, or trusted HTML document.
<!-- planloft:command-knowledge:end -->

Never deploy unless the user explicitly requests publication. GitHub Pages publication
uses a public, enumerable repository and manifest.

## Finish

Report the exact saved path. Do not preview, copy, render, hoist, or deploy unless the
user also requests that action.
