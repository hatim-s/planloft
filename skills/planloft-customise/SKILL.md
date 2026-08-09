---
name: planloft-customise
description: >-
  Explain Planloft's document pipeline, storage, theme resolution, and publication
  boundaries, or create, modify, validate, and troubleshoot a Planloft custom theme.
  Use when the user asks how Planloft works, wants a new visual or authoring theme,
  needs theme configuration help, or reports a theme asset or layout error. Do not use
  for ordinary document authoring; use planloft-write-doc for that.
---

# Customise Planloft

Ground explanations and theme changes in Planloft's actual contracts. Codex UI metadata
labels this skill `planloft:customise`; Claude Code and other Agent Skills hosts use the
portable name `planloft-customise`. Keep document authoring in `planloft-write-doc` and
one-step document operations in the CLI.

## Choose the workflow

- For architecture, data flow, storage, command behavior, or safety questions, read
  [references/how-planloft-works.md](references/how-planloft-works.md).
- For theme selection, configuration, creation, editing, validation, or errors, read
  [references/themes.md](references/themes.md).
- For a request spanning both, read both references before acting.

## Inspect before changing

Confirm whether the task targets an installed Planloft home or this source repository.
Inspect existing configuration and theme files before editing. Preserve unrelated
settings and assets.

For an installed environment, require `planloft` on `PATH` and run:

```sh
command -v planloft
planloft init
```

`planloft init` is local and idempotent. If the executable is missing, stop with the
CLI installation requirement.

## Create or change a theme

Use the effective Planloft home: `PLANLOFT_HOME` when set, otherwise the user's
`.planloft` directory. Place a user theme at `themes/<name>/` inside that home. Validate
the name before writing: it must start with a letter or number and contain only letters,
numbers, dots, underscores, and hyphens.

For a new theme, start from [assets/theme-starter/](assets/theme-starter/) and tailor
only the assets the user needs:

- `style.css` controls presentation and must deliberately support light and dark.
- `template.md` guides agents that author documents using the theme.
- `layout.html` is optional and constrained; omit it to use Planloft's default layout.

Do not overwrite an existing theme or replace a built-in name without explicit user
intent. A user theme with a built-in name intentionally shadows that built-in.

## Validate locally

Render representative Markdown with the selected theme before reporting success:

```sh
planloft render <fixture.md> --theme <name> --out <temporary-output-directory>
```

Check headings, paragraphs, lists, links, inline code, code blocks, blockquotes, and
tables. Inspect both explicit light and dark modes, the system preference, narrow and
wide layouts, keyboard focus, and readable contrast. Confirm the theme toggle remains
the first control in the body.

Run repository tests when changing bundled themes or renderer contracts. A local custom
theme should not require source-code changes.

Never publish or deploy a validation document unless the user explicitly requests it.

## Report

Explain the effective theme resolution, list the files created or changed, name the
local validation performed, and call out anything not visually verified.
