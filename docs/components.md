# MDX components

Planloft's built-ins render to static HTML and SVG. They do not hydrate React in the
browser. A trusted MDX document can use built-in tags without importing them, or
import them explicitly:

```mdx
import { Callout, Checklist, Todo, Stat, Stats, LineChart, DataTable } from 'planloft/components'

# Release readiness

<Callout tone="warning" title="Before release">
  Confirm that the rollback path works.
</Callout>

<Stats>
  <Stat label="Checks passed" value={18} change={3} period="since yesterday" />
</Stats>

<Checklist title="Release steps">
  <Todo task="release.verify-rollback" label="Verify rollback" owner="API" />
  <Todo task="release.publish-notes" label="Publish release notes" due="Friday" />
</Checklist>

<LineChart
  title="Checks passed"
  data={[{ day: 'Mon', passed: 12 }, { day: 'Tue', passed: 18 }]}
  x="day"
  y="passed"
/>

<DataTable
  data={[{ team: 'API', passed: 18 }, { team: 'Web', passed: 16 }]}
  columns={['team', 'passed']}
  sort="-passed"
  caption="Checks by team"
/>
```

Run `planloft render report.mdx --trusted-mdx --out ./report-site` or
`planloft hoist report.mdx --trusted-mdx` only when you trust the source, imports,
registries and compiled snapshot. Imports and expressions execute at compile or render
time. The generated page contains static component output, not a general interactive
component runtime. Local `.tsx` and `.mdx` imports resolve relative to the source;
project `.planloft/components/index.tsx` overrides global
`~/.planloft/components/index.tsx`, which overrides built-ins for unimported tags.
Explicit imports use their imported bindings. A stored document renders from its
pinned snapshot, so component fixes in a newer Planloft reach it only after you hoist
it again from its source.

## Available components

| Component | Main inputs |
| --- | --- |
| `Callout` | `children`; optional `tone` (`note`, `tip`, `warning`, `risk`, `decision`) and `title` |
| `Stat`, `Stats` | `Stat` takes `label` and `value`; optional `change`, `period`, `good`, and `trend`. Numbers retain their precision unless `format="compact"` is explicit. A numeric `change` inherits the value's format unless `changeFormat` overrides it. The unit carries over except for percent changes. Unsigned nonzero text shows no arrow; signed zero is neutral. `Stats` groups children. |
| `Status` | `tone`: `done`, `on-track`, `at-risk`, `blocked`, or `not-started`; optional children replace the displayed label. |
| `Badge` | `children` is the label; optional `color`: `gray` (default), `red`, `orange`, `yellow`, `green`, `teal`, `blue`, `purple`, `pink`, or `accent`. |
| `Checklist`, `Todo` | `Todo` takes a stable `task` and `label` or children; optional `checked`, `owner`, and `due`. `Checklist` groups children and can have a `title`. |
| `Timeline`, `Milestone` | `Timeline` groups milestones; each `Milestone` takes `title` and optional `date`, `state`, and children. |
| `DataTable` | `data`, optional `columns`, `sort`, `totals`, and `caption`. Column entries are keys or objects with `key`, `label`, and formatting. `format: "status"` renders Status markers; `format: "badge"` renders badges coloured by the column's `colors` map. |
| `LineChart`, `BarChart` | `data`, `x`, and `y`; `y` can be one column or a list. Bars also accept `layout` and `orientation`. |
| `DonutChart`, `WaterfallChart` | `data`, `label`, and `value` name the row fields. Waterfall accepts `opening` and `total`. |
| `Heatmap` | `data`, `x`, `y`, and `value` name the row fields. |
| `Sparkline` | `values` contains at least two numbers; optional `label` describes the trend. |

Chart and table `data` is a non-empty array of objects whose values are strings,
numbers, or null. Chart titles and captions describe the data. Every mark in a chart
shows its category, series, and exact value in a tooltip on hover, tap, or keyboard
focus; a missing value reads as a dash, never as zero. A chart is one tab stop; arrow
keys, Home, and End move between its marks. Each chart also carries a visually hidden
table of the same values, with the same percent, currency, and unit formatting as the
tooltip. Number formats are `number`, `compact`, `percent`, and `currency`; percent
values are fractions, so `0.42` displays as 42%. An unknown format or currency code is
an authoring error that names the component. Axis labels use the compact form.
Tooltips keep the precision of the values you wrote, and computed totals such as
stack sums and running balances show the exact decimal sum, without floating-point
noise. `DataTable` cells and totals use standard notation unless a column asks for
`compact`; currency shows the currency's usual decimals plus any extra decimals you
wrote. For a compact currency headline in a Stat, supply a formatted string such as
`value="$1.2M"`; `format="compact"` abbreviates numbers without a currency symbol.

## Badges

`Badge` is a small coloured label for categories, versions, owners, and similar tags.
It works inline in a sentence and inside table cells. `Status` stays the marker for
delivery state: it has fixed tones and a glyph per tone. A badge's colour only groups
labels, so the label text has to carry the meaning on its own.

```mdx
The importer moves to the new queue <Badge color="blue">v2.4</Badge> behind a flag.

| Endpoint | Labels |
| --- | --- |
| `POST /documents` | <Badge color="green">stable</Badge> |
| `DELETE /comments/:id` | <Badge color="red">deprecated</Badge> <Badge>removed in v3</Badge> |

<table>
  <tbody>
    <tr><td>Search</td><td><Badge color="yellow">preview</Badge></td></tr>
  </tbody>
</table>

<DataTable
  data={[{ theme: 'editorial', tier: 'Built-in' }, { theme: 'acme-annual', tier: 'Project' }]}
  columns={['theme', { key: 'tier', format: 'badge', colors: { 'Built-in': 'accent', Project: 'teal' } }]}
/>
```

Each colour is a fixed hue mixed toward the theme's ink for the text and toward its
paper for the fill, so badges stay legible in light and dark themes and inside regions
that override `--planloft-paper` or `--planloft-ink`. `accent` follows the theme accent
and `gray` follows its muted colour. A pill that is wider than its cell wraps inside
itself; otherwise it moves to the next line whole. In a DataTable, values missing from
`colors` render gray, and the column still sorts as text.

Authored HTML documents get the same styles, so they can write the rendered markup
directly: `<span class="pl-badge" data-color="green">stable</span>`.

## Shared task keys

A `Todo`'s `task` key names one shared task. It must start with an ASCII letter or
digit, contain only letters, digits, `.`, `_`, `:`, and `-`, and be at most 80
characters. Two `Todo`s with the same key are the same task: they share one checked
state, though each gets its own HTML id. Use a new key for a separate task. Keep the
key when the label changes; a different key starts a separate shared task. The checkbox is disabled until the optional collaboration client loads
state. Ordinary GFM task lists are static and do not acquire shared state, and the
migration tool does not infer keys from task text. Collaboration must be enabled
explicitly. Other readers' changes appear after a reload; there is no polling.

Stacked bar tooltips show every series and the total, so small overlapping segments remain readable. A tooltip with several rows may omit the colour swatch. Categories must be unique: line and bar charts reject repeated category labels, heatmaps reject a repeated x and y pair, and waterfall charts reject repeated step labels, including a step that reuses the total's label. Combine the repeated rows or label them distinctly. Very small tooltip values use scientific notation to preserve their available precision.
