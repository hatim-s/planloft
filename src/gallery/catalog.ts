import type { builtinComponents } from "../components/index.js";

export interface CatalogEntry {
  /** Section anchor and display name. */
  name: string;
  /** The built-ins this example demonstrates. */
  components: readonly (keyof typeof builtinComponents)[];
  summary: string;
  /** MDX rendered on the catalog page and shown verbatim as the usage snippet. */
  example: string;
}

// Each example is real MDX: the catalog page renders it through the compiler and prints
// the same string beneath it, so a snippet can never drift from what it produces.
export const CATALOG: readonly CatalogEntry[] = [
  {
    name: "Line chart",
    components: ["LineChart"],
    summary: "Ordered values with a fading area fill. One column per line; a single line gets its latest value labelled.",
    example: `<LineChart
  title="Weekly active writers"
  data={[
    { week: "W1", writers: 1180 },
    { week: "W2", writers: 1260 },
    { week: "W3", writers: 1240 },
    { week: "W4", writers: 1410 },
    { week: "W5", writers: 1530 },
    { week: "W6", writers: 1620 },
  ]}
  x="week"
  y="writers"
  format="compact"
/>`,
  },
  {
    name: "Multiple lines",
    components: ["LineChart"],
    summary: "Pass several columns to `y`. Each line keeps its own gradient; `area={false}` draws lines only.",
    example: `<LineChart
  title="Median build time by platform"
  data={[
    { month: "May", linux: 6.2, macos: 8.9, windows: 11.4 },
    { month: "Jun", linux: 5.8, macos: 8.1, windows: 10.9 },
    { month: "Jul", linux: 5.1, macos: 7.6, windows: 10.2 },
    { month: "Aug", linux: 4.9, macos: 6.8, windows: 9.1 },
    { month: "Sep", linux: 4.4, macos: 6.1, windows: 8.3 },
  ]}
  x="month"
  y={["linux", "macos", "windows"]}
  labels={{ macos: "macOS" }}
  unit="min"
/>`,
  },
  {
    name: "Bar chart",
    components: ["BarChart"],
    summary: "Categorical comparison from a zero baseline, with values at the bar ends.",
    example: `<BarChart
  title="Plans published per team"
  data={[
    { team: "Platform", plans: 42 },
    { team: "Payments", plans: 31 },
    { team: "Search", plans: 27 },
    { team: "Mobile", plans: 18 },
  ]}
  x="team"
  y="plans"
/>`,
  },
  {
    name: "Grouped bars",
    components: ["BarChart"],
    summary: "Several `y` columns sit side by side. A legend names each series.",
    example: `<BarChart
  title="Incidents by severity"
  data={[
    { quarter: "Q1", sev1: 2, sev2: 7, sev3: 15 },
    { quarter: "Q2", sev1: 1, sev2: 9, sev3: 12 },
    { quarter: "Q3", sev1: 0, sev2: 5, sev3: 11 },
  ]}
  x="quarter"
  y={["sev1", "sev2", "sev3"]}
  labels={{ sev1: "Sev 1", sev2: "Sev 2", sev3: "Sev 3" }}
/>`,
  },
  {
    name: "Stacked bars",
    components: ["BarChart"],
    summary: "`layout=\"stacked\"` shows the parts of each total. Hover any segment to see every part and the total.",
    example: `<BarChart
  title="Monthly spend by service"
  data={[
    { month: "Jul", compute: 18400, storage: 6200, network: 3100 },
    { month: "Aug", compute: 19800, storage: 6600, network: 3400 },
    { month: "Sep", compute: 17100, storage: 7000, network: 3300 },
  ]}
  x="month"
  y={["compute", "storage", "network"]}
  layout="stacked"
  format="currency"
/>`,
  },
  {
    name: "Horizontal bars",
    components: ["BarChart"],
    summary: "`orientation=\"horizontal\"` suits long labels and rankings; `sort` orders by value.",
    example: `<BarChart
  title="Time to first review"
  data={[
    { repo: "planloft/compiler", hours: 3.5 },
    { repo: "planloft/collaboration-service", hours: 9.2 },
    { repo: "planloft/themes", hours: 5.1 },
    { repo: "planloft/docs", hours: 14.8 },
  ]}
  x="repo"
  y="hours"
  orientation="horizontal"
  sort="descending"
  unit="h"
/>`,
  },
  {
    name: "Waterfall",
    components: ["WaterfallChart"],
    summary: "Signed changes bridging an opening balance to a total. Rises and falls are labelled with their sign.",
    example: `<WaterfallChart
  title="Annual recurring revenue, Q3"
  data={[
    { step: "Opening", change: 1200000 },
    { step: "New", change: 310000 },
    { step: "Expansion", change: 140000 },
    { step: "Contraction", change: -60000 },
    { step: "Churn", change: -95000 },
  ]}
  label="step"
  value="change"
  total="Closing"
  format="currency"
/>`,
  },
  {
    name: "Donut",
    components: ["DonutChart"],
    summary: "Parts of one whole, up to six slices. The legend lists each value and share.",
    example: `<DonutChart
  title="Where review time goes"
  data={[
    { activity: "Reading", hours: 46 },
    { activity: "Discussion", hours: 31 },
    { activity: "Rework", hours: 18 },
    { activity: "Waiting", hours: 12 },
  ]}
  label="activity"
  value="hours"
  unit="h"
  centerLabel="Hours"
/>`,
  },
  {
    name: "Heatmap",
    components: ["Heatmap"],
    summary: "Intensity across two categories, in five steps of one hue.",
    example: `<Heatmap
  title="Deploys by weekday and hour"
  data={[
    { day: "Mon", hour: "09", deploys: 4 }, { day: "Mon", hour: "12", deploys: 9 }, { day: "Mon", hour: "15", deploys: 12 }, { day: "Mon", hour: "18", deploys: 3 },
    { day: "Tue", hour: "09", deploys: 6 }, { day: "Tue", hour: "12", deploys: 11 }, { day: "Tue", hour: "15", deploys: 14 }, { day: "Tue", hour: "18", deploys: 5 },
    { day: "Wed", hour: "09", deploys: 5 }, { day: "Wed", hour: "12", deploys: 10 }, { day: "Wed", hour: "15", deploys: 13 }, { day: "Wed", hour: "18", deploys: 4 },
    { day: "Thu", hour: "09", deploys: 3 }, { day: "Thu", hour: "12", deploys: 8 }, { day: "Thu", hour: "15", deploys: 7 }, { day: "Thu", hour: "18", deploys: 2 },
    { day: "Fri", hour: "09", deploys: 2 }, { day: "Fri", hour: "12", deploys: 4 }, { day: "Fri", hour: "15", deploys: 1 }, { day: "Fri", hour: "18", deploys: 0 },
  ]}
  x="hour"
  y="day"
  value="deploys"
/>`,
  },
  {
    name: "Stats and sparklines",
    components: ["Stats", "Stat", "Sparkline"],
    summary: "Headline figures with a signed change and an optional trend. `good=\"down\"` marks figures where a fall is good. Sparkline also works inline in prose.",
    example: `<Stats>
  <Stat label="Published plans" value={1284} change={0.12} changeFormat="percent" period="vs September" trend={[860, 910, 990, 1050, 1120, 1190, 1284]} />
  <Stat label="Median time to publish" value="2.4 days" change="-0.8 days" good="down" period="vs September" />
  <Stat label="Open comments" value={37} change={0} period="vs last week" />
</Stats>

Weekly signups <Sparkline values={[12, 15, 14, 19, 22, 21, 26]} label="Weekly signups" /> keep climbing.`,
  },
  {
    name: "Data table",
    components: ["DataTable"],
    summary: "Rows from data, ordered by TanStack Table. Numeric columns align right; `sort` takes a key or `-key`; `totals` adds a sum row.",
    example: `<DataTable
  data={[
    { service: "api", p50: 41, p99: 380, errors: 0.0012 },
    { service: "renderer", p50: 120, p99: 910, errors: 0.0031 },
    { service: "collaboration", p50: 22, p99: 140, errors: 0.0004 },
    { service: "search", p50: 65, p99: 1240, errors: 0.0057 },
  ]}
  columns={[
    "service",
    { key: "p50", label: "p50", unit: "ms" },
    { key: "p99", label: "p99", unit: "ms" },
    { key: "errors", label: "Error rate", format: "percent" },
  ]}
  sort="-p99"
  caption="Last 7 days, production."
/>`,
  },
  {
    name: "Callouts",
    components: ["Callout"],
    summary: "Set-apart passages in five tones. The tone name is printed, so meaning never depends on colour.",
    example: `<Callout tone="note">Drafts are private until you publish them.</Callout>

<Callout tone="tip" title="Faster review">Put the decision in the first paragraph.</Callout>

<Callout tone="warning" title="Freeze starts Nov 20">Merge risky changes before the freeze.</Callout>

<Callout tone="risk" title="Single region">The queue runs in one region; an outage pauses indexing.</Callout>

<Callout tone="decision" title="Ship behind a flag">The new editor ships to 10% of teams first.</Callout>`,
  },
  {
    name: "Status",
    components: ["Status"],
    summary: "Inline state markers. Each tone has its own glyph as well as its colour.",
    example: `Checkout failover <Status tone="done" />, alert cleanup <Status tone="on-track" />, search capacity <Status tone="at-risk" />, data export <Status tone="blocked" />, audit log <Status tone="not-started" />.`,
  },
  {
    name: "Badges",
    components: ["Badge", "DataTable"],
    summary: "Coloured labels for prose and table cells. `color` takes gray (the default), red, orange, yellow, green, teal, blue, purple, pink, or accent. Use Status for delivery state; badges are for categories, versions and owners. A DataTable column with `format=\"badge\"` colours its values from `colors`.",
    example: `The importer moves to the new queue <Badge color="blue">v2.4</Badge> and stays behind a flag <Badge color="yellow">preview</Badge> until the load test passes.

| Endpoint | Owner | Labels |
| --- | --- | --- |
| \`POST /documents\` | Platform | <Badge color="green">stable</Badge> |
| \`GET /documents/:id/history\` | Collaboration | <Badge color="yellow">preview</Badge> <Badge color="purple">needs auth review</Badge> |
| \`DELETE /comments/:id\` | Collaboration | <Badge color="red">deprecated</Badge> <Badge>removed in v3</Badge> |

<DataTable
  data={[
    { theme: "editorial", tier: "Built-in", schemes: "light, dark" },
    { theme: "briefing", tier: "Built-in", schemes: "light, dark" },
    { theme: "acme-annual", tier: "Project", schemes: "light" },
  ]}
  columns={["theme", { key: "tier", format: "badge", colors: { "Built-in": "accent", Project: "teal" } }, "schemes"]}
/>`,
  },
  {
    name: "Checklist",
    components: ["Checklist", "Todo"],
    summary: "Shared tasks. Each Todo needs a stable `task` key; the collaboration runtime enables the boxes and keeps their state, and they stay disabled on pages without it.",
    example: `<Checklist title="Launch">
  <Todo task="launch-docs" owner="Docs" due="Nov 4">Publish the migration guide</Todo>
  <Todo task="launch-flag" owner="Platform" checked>Enable the flag for internal teams</Todo>
  <Todo task="launch-announce" label="Announce in the changelog" owner="Product">
    Link the migration guide and the gallery.
  </Todo>
</Checklist>`,
  },
  {
    name: "Timeline",
    components: ["Timeline", "Milestone"],
    summary: "Milestones in the order written, each with a date label and a state.",
    example: `<Timeline>
  <Milestone date="Oct 6" title="Design review" state="done" />
  <Milestone date="Oct 20" title="Compiler and themes" state="done" />
  <Milestone date="Nov 3" title="Collaboration beta" state="active">
    Public documents only; comments, notes and shared checklists.
  </Milestone>
  <Milestone date="Nov 17" title="Restricted access" state="blocked">Waiting on the access policy.</Milestone>
  <Milestone date="Dec 1" title="General availability" state="planned" />
</Timeline>`,
  },
];

export function catalogDocument(): string {
  const sections = CATALOG.map((entry) => {
    const anchor = catalogAnchor(entry.name);
    return `<section id="${anchor}">

## ${entry.name}

${entry.summary}

${entry.example}

\`\`\`mdx
${entry.example}
\`\`\`

</section>`;
  });
  return `# Built-in components

Every built-in renders to static HTML and SVG when the document compiles. Use them in any
\`.mdx\` document without an import. Each example below is the exact source printed under it.

${sections.join("\n\n")}
`;
}

export function catalogAnchor(name: string): string {
  return `component-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}
