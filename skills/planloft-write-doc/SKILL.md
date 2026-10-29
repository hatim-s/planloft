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

Run `scripts/resolve-planloft-command.sh` using the absolute path to this skill
directory, not the current working directory, and capture the executable path it prints. A skill-only install requires a
separately installed Planloft CLI on `PATH`.

```sh
PLANLOFT_COMMAND="$(<absolute-skill-directory>/scripts/resolve-planloft-command.sh)"
```

If the resolver exits non-zero, stop and relay its actionable installation message.
Skill installation does not install the executable, themes, or runtime assets.

## Resolve the target

Choose `md`, `mdx`, or `html` for the document, then derive a short kebab-case slug
and a human title. Resolve the chosen format with real values:

```!
"$PLANLOFT_COMMAND" resolve --kind plan --format <md|mdx|html> --slug "<slug>" --title "<title>"
```

The format defaults to `md` when omitted. The result includes `path`, `format`,
`themeCss`, and `themePath`. Use the returned path for a Markdown source. For MDX or
HTML, use the result as the intended store target and hoist a source as described below.
Never guess or synthesize a store path. If resolution fails, report the error.

## Author and persist

Choose the content and structure for the user's needs. Themes supply colors and typography, not an authoring template or required document structure. Select the requested theme, or use the resolved default. Inspect the resolved theme CSS and use its `--planloft-*` variables when authoring custom HTML or CSS.

For Markdown, write at the returned path. For MDX, author a source file in the project with its relative dependencies, then run
`"$PLANLOFT_COMMAND" hoist <source.mdx> --trusted-mdx --slug "<slug>" --title "<title>" --kind plan` to compile and store it.
Do not write MDX directly to the resolved store path: the stored source needs its
compiled dependency snapshot. Only execute MDX and registry code you trust.

For HTML, author a `.html` source file in the project and store it with
`"$PLANLOFT_COMMAND" hoist <source.html> --trusted-html --slug "<slug>" --title "<title>" --kind plan`. Use trusted HTML only for
content you control. Do not write HTML directly to a resolved store path.

Start Markdown and MDX with complete frontmatter:

```yaml
---
title: <title>
slug: <slug>
kind: plan
status: active
---
```

Name concrete files, modules, commands, dependencies, risks, and unresolved decisions.
Use Markdown, MDX, or authored HTML as the content requires. Markdown and MDX render in the shared `.planloft-prose` shell. Authored HTML retains its own structure, styles, and scripts; use `.planloft-prose` for optional semantic styling and `.planloft-plan > article` for reading/full-width support. See [the theme variable reference](references/theme-variables.md) for the public variables and an HTML example.

## Components and shared tasks

Built-in MDX components are available by name without imports, or can be imported from
`planloft/components`. Use them when they clarify the document; check the package documentation for component props. Built-in
charts and tables render static output. Do not imply custom component state persists.

Use `<Status tone="...">` for delivery state and `<Badge color="...">label</Badge>` for
other short tags such as versions, owners, or categories, in prose or table cells. Pick
badge colours by grouping, keep the label meaningful without colour, and skip badges
on labels that plain text already makes clear.

For a shared checkbox use `<Todo task="ship-api" label="Ship the API" />`. Give each task
a unique, stable key within the document. Keys start with a letter or digit, contain
only letters, digits, `.`, `_`, `:`, or `-`, and are at most 80 characters. Retain a
key when wording changes. The checkbox is disabled until collaboration state loads;
ordinary Markdown task lists do not become shared tasks. Do not invent keys by matching
old task text or enable collaboration without a request.

## Design for both light and dark

Treat dual-theme presentation as mandatory for every authored or rendered plan
document:

- Keep Markdown renderer-neutral; apply the same rule to MDX. Use theme variables for custom colors so both modes remain legible.
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
- `"$PLANLOFT_COMMAND" publish page.html --trusted-html` deploys trusted HTML with theme tokens and reader controls, preserving its structure.
<!-- planloft:command-knowledge:end -->

Never deploy unless the user explicitly requests publication. GitHub Pages publication
uses a public, enumerable repository and manifest.

## Finish

Report the exact saved path. The MDX or HTML hoist above is part of saving. Do not preview, copy, render, or deploy unless the
user also requests that action.
