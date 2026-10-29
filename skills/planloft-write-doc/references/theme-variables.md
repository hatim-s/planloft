# Theme CSS for authored HTML

Inspect the `themeCss` and `themePath` returned by `planloft resolve` for the selected
theme before writing custom CSS. Use the public `--planloft-*` color and typography
variables defined there so the document follows light and dark appearance. Keep layout
in the document's own HTML and CSS. Add `.planloft-prose` only where semantic prose
styling is wanted; use `.planloft-plan > article` when reading/full-width controls
should affect the article.

## Public theme variables

Colors are defined for light, dark system preference, explicit dark, and print. Use the selected theme CSS to inspect the selectors and marker. Typography variables are state-independent.
Use local font stacks. Themes set variables only; document CSS owns layout and shape.
The old unprefixed color and chart names are not aliases for these variables.

| Color variable | Use |
|---|---|
| `--planloft-paper`, `--planloft-ink` | Page background and body text |
| `--planloft-muted`, `--planloft-surface`, `--planloft-rule` | Secondary text, inset background, borders |
| `--planloft-accent`, `--planloft-accent-contrast` | Links and active marks; text on accent fill |
| `--planloft-code-paper`, `--planloft-code-ink` | Code background and text |
| `--planloft-chart-1` through `--planloft-chart-6` | Categorical chart series |
| `--planloft-chart-sequential`, `--planloft-chart-neutral` | Heatmap hue; totals and baselines |
| `--planloft-positive`, `--planloft-negative`, `--planloft-caution` | Status colors |

| Typography variable | Use |
|---|---|
| `--planloft-font-body`, `--planloft-font-heading`, `--planloft-font-mono` | Font stacks |
| `--planloft-font-size`, `--planloft-line-height`, `--planloft-code-size` | Absolute base size (for example `17px`), unitless body line height, code size relative to its context (for example `0.88em`) |
| `--planloft-heading-weight`, `--planloft-heading-line-height`, `--planloft-heading-tracking` | Heading weight, unitless line height, letter spacing |
| `--planloft-h1-size`, `--planloft-h2-size`, `--planloft-h3-size` | Heading sizes relative to the body size in `em` |

Frameset HTML is not supported. Convert it to an ordinary body or keep the original
externally.

## Authored HTML example

Save this as `report.html` and run `planloft render report.html --trusted-html --theme
editorial --out ./report-site`. The selected theme supplies the variables and controls.
The document owns its layout and can override a theme token locally. The prose class is
opt-in; omit it for fully custom semantic styling.

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Release report</title>
  <style>
    body { margin: 0; background: var(--planloft-paper); color: var(--planloft-ink);
      font: var(--planloft-font-size)/var(--planloft-line-height) var(--planloft-font-body); }
    .summary { border-left: 4px solid var(--planloft-accent); padding: 1rem;
      background: var(--planloft-surface); }
    .summary strong { color: var(--planloft-accent); }
    /* A document-owned override, scoped to one region. */
    .summary { --planloft-accent: var(--planloft-positive); }
  </style>
</head>
<body>
  <main class="planloft-plan">
    <article class="planloft-prose">
      <h1>Release report</h1>
      <div class="summary"><strong>Ready:</strong> The API is deployed.</div>
      <p>Review the rollout before enabling the next region.</p>
    </article>
  </main>
</body>
</html>
```
