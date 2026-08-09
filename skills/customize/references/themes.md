# Planloft customization theme contract

## Directory and resolution

Create user themes under the effective Planloft home:

```text
<planloft-home>/themes/<name>/
  style.css
  template.md
  layout.html
```

All three files are optional after the directory itself resolves. `style.css` defaults
to an empty skin, `template.md` defaults to generic authoring guidance, and
`layout.html` defaults to Planloft's document shell. In practice, a visual theme should
provide `style.css` and an authoring theme should provide `template.md`.

Valid names match `^[a-zA-Z0-9][a-zA-Z0-9._-]*$`. A user directory takes precedence
over a bundled theme with the same name. Effective theme selection is document
metadata, then project configuration, then the global configuration default.

## CSS requirements

Include this exact marker when the theme provides its own complete dual palette:

```css
/* planloft-color-schemes: light dark */
```

Define all four states:

1. Light variables on `:root`.
2. System dark variables in `@media (prefers-color-scheme: dark)` for
   `:root:not([data-planloft-color-scheme="light"])`.
3. Explicit light variables on `:root[data-planloft-color-scheme="light"]`.
4. Explicit dark variables on `:root[data-planloft-color-scheme="dark"]`.

Planloft injects the top theme control and persists its explicit selection. Without the
marker, the renderer adds a readable system-color fallback, but it cannot invent a
deliberate dark palette for custom components.

Style semantic Markdown output rather than hand-authored presentation markup. Cover at
least body text, headings, links, lists, code, preformatted blocks, blockquotes, tables,
rules, and focus states. Preserve horizontal overflow for code and tables on narrow
screens.

## Authoring guidance

`template.md` is returned by `planloft resolve` so an agent can match document structure
and voice to the theme. Keep it renderer-neutral:

- Require Markdown, not generated HTML.
- Describe useful structure, density, and voice.
- Avoid hard-coded presentation colors or layout markup.
- Require content to remain legible in light and dark.

Do not put general Planloft operation instructions in a theme template.

## Constrained layouts

`layout.html` must contain `{{body}}`. It may use only:

- `{{title}}` — escaped document title.
- `{{kind}}` — escaped document kind.
- `{{body}}` — renderer-owned Markdown or trusted HTML body.
- `{{styles}}` — theme and Planloft control CSS.
- `{{robots}}` — publication metadata slot.
- `{{comments}}` — optional giscus section.

Layouts have no expressions, conditions, includes, filesystem access, or executable
template code. Planloft repairs fragmentary shells and injects styles, comments,
`noindex`, and the theme toggle when their optional slots are absent, but a complete
semantic HTML shell is easier to reason about.

Do not add scripts to a custom layout. Keep `{{body}}` inside the primary article or
content region, and leave the theme toggle to the renderer.

## Configuration

Set the global default with `planloft config` by changing the top-level `theme`. Set a
project override in `projects.<project-key>.theme`, or set `theme` in document metadata
for the narrowest override. Preserve the strict version-1 object and unrelated settings.

Do not edit configuration merely to test a theme. Use `planloft render <input> --theme
<name> --out <directory>` so validation is isolated.

## Validation checklist

- Theme directory resolves and the render command exits successfully.
- The body appears inside a valid HTML document with styles in the head.
- System, explicit light, and explicit dark modes are readable.
- The theme toggle is the first body control and has visible keyboard focus.
- Long code, tables, and URLs do not break narrow layouts.
- Heading hierarchy, lists, quotes, links, and code are visually distinct.
- `template.md` produces useful Markdown without presentation markup.
- No publish or deploy occurs during validation.

For a new theme, copy and tailor the skill's `assets/theme-starter/` files rather than
reconstructing this contract from memory.
