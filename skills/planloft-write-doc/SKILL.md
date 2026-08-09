---
name: planloft-write-doc
description: >-
  Author and persist substantial Planloft documents, then route follow-up rendering,
  storage, preview, copying, or explicit publication through the Planloft CLI. Use when
  the user asks Planloft to write or save durable implementation, migration, refactor,
  architecture, design, or other standalone document content.
---

# Write a Planloft document

Persist substantial authored documents directly and keep them reviewable without
conversation history. Codex UI metadata labels this skill `planloft:write-doc`; Claude
Code and other Agent Skills hosts use the portable name `planloft-write-doc`.

## Check the prerequisite

Run the bundled `scripts/resolve-planloft-command.sh` from this skill directory before
resolving and capture the executable path it prints. A skill-only install requires a
separately installed Planloft CLI on `PATH`.

```sh
PLANLOFT_COMMAND="$(./scripts/resolve-planloft-command.sh)"
```

If the resolver exits non-zero, stop and relay its actionable installation message.
Skill installation does not install the executable, themes, or runtime assets.

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
- When a renderer or theme provider exists, use its light/dark/system selector and
  system-theme behavior. Planloft's renderer puts an accessible compact icon selector
  at the very top and initially honors the browser's `prefers-color-scheme` setting.
- When producing standalone HTML outside that renderer, put an accessible theme selector
  with light, dark, and system options at the very top and also implement a
  `prefers-color-scheme` system fallback.
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
