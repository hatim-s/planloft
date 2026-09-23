# Built-in Planloft themes

A Planloft theme combines renderer-neutral authoring guidance (`template.md`) with a
light/dark visual skin (`style.css`). Choose a theme for the document's job and the
reading experience you want:

| Theme | Best for | Authoring emphasis | Set in |
|---|---|---|---|
| `minimal` | Checklists and terse execution plans | Flat, compact steps | Monospace, monochrome, heading marks kept visible |
| `detailed` | Technical implementation plans | Context, ordered work, risks | Neutral sans, section bars in the margin, room for code |
| `editorial` | Narrative proposals | Situation, tension, approach, outcome | Old-style serif, narrow column, drop cap, hanging quotes |
| `decision` | ADRs and durable choices | Options, criteria, rationale, consequences | Grotesk sans, ruled sections, fully boxed options table |
| `research` | Investigations and evidence reviews | Sources, confidence, gaps, implications | Text serif with sans headings and tables, tinted excerpts |
| `briefing` | Status updates and leadership reviews | Signals, asks, owners, next moves | Humanist sans, the first paragraph set as a lede |

Built-in themes share a responsive report layout. The report container has 200px of total
side gutters on wide screens, 100px at 64rem and below, and 50px at 40rem and below.
It has no per-theme max-width cap. Themes use off-black on off-white in light mode and
soft grey on charcoal in dark mode, and style the full Markdown vocabulary: headings to
level six, lists and task lists, links, inline code and code blocks, quotes, tables that
scroll sideways on narrow screens, rules, images, keyboard keys, and the comments section.

Render a document with a one-off choice:

```bash
planloft render document.md --theme research --out ./document-site
```

Set the default or a project override with `planloft config`. A custom theme under
`~/.planloft/themes/<name>` takes precedence over a built-in with the same name.
