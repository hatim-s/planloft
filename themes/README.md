# Built-in Planloft themes

A Planloft theme combines renderer-neutral authoring guidance (`template.md`) with a
light/dark visual skin (`style.css`). Choose a theme for the document's job and desired
reading experience:

| Theme | Best for | Authoring emphasis |
|---|---|---|
| `minimal` | Checklists and terse execution plans | Flat, compact steps |
| `detailed` | Technical implementation plans | Context, ordered work, risks |
| `editorial` | Narrative proposals | Situation, tension, approach, outcome |
| `decision` | ADRs and durable choices | Options, criteria, rationale, consequences |
| `research` | Investigations and evidence reviews | Sources, confidence, gaps, implications |
| `briefing` | Status updates and leadership reviews | Signals, asks, owners, next moves |

Render a document with a one-off choice:

```bash
planloft render document.md --theme research --out ./document-site
```

Set the default or a project override with `planloft config`. A custom theme under
`~/.planloft/themes/<name>` takes precedence over a built-in with the same name.
