// One long-form document shown in every theme, so the gallery compares the themes and
// not the content. It is deliberately ordinary: a planning document with every
// Markdown element and most built-in components, written for no theme in particular.
// It is a demonstration, not an authoring template; nothing distributes it.
export const SPECIMEN_TITLE = "Moving the archive catalogue to one index";

export const SPECIMEN_MDX = `# ${SPECIMEN_TITLE}

Three catalogues describe the same shelves. This plan merges them into one index over
eight weeks, keeps every record reachable during the move, and leaves the reading room
with a search that answers in under a second.

## Why now

The oldest catalogue stops receiving security updates in March. Its export format is
documented, which is the reason to move this year rather than next: once that
documentation goes, the 140,000 records in it become a recovery project instead of a
migration. The other two catalogues are small, but they hold the only copies of the
loan history since 2019.

Staff search all three today. A reader asking for a 1950s pamphlet waits while a
librarian checks each system in turn, and about one request in five is answered
wrongly because the systems disagree on a shelf mark. The merged index removes the
disagreement by making one record the owner of each shelf mark.

<Stats>
  <Stat label="Records to merge" value="212,400" change="+3.1%" period="since the last count" />
  <Stat label="Duplicate shelf marks" value="4,118" change="-12%" period="after the dry run" good="down" />
  <Stat label="Median search time" value="6.4 s" change="+0.8 s" period="this quarter" good="down" />
  <Stat label="Weekly loans" value="1,930" />
</Stats>

## What changes for readers

Readers keep the same card and the same loan rules. Two things change:

1. One search box. The reading-room terminals and the public site search the merged
   index, so a result either exists or it does not. There is no second place to look.
2. Shelf marks become stable. A record keeps its mark for life; a moved item gets a
   location note instead of a new mark.

Things that stay the same, because they were asked about:

- Opening hours and the request slip.
- Reservations placed before the move. They carry over with their original queue
  position.
- The microfilm readers, which have nothing to do with the catalogue.

> "The best catalogue is the one nobody notices. If a reader has to learn it, we
> built the wrong thing."
>
> From the reading-room survey, March

## Approach

### Make the oldest catalogue the source of truth for shelf marks

The oldest system has the most complete shelf-mark history, so its marks win every
conflict. The two smaller catalogues contribute loan history and subject headings.
Where a record exists in more than one place, the merge keeps the oldest mark and
attaches the other fields.

The matching rule, in order:

1. Exact match on ISBN or ISSN.
2. Exact match on shelf mark after normalising spaces and case.
3. Title and first author within an edit distance of two, with a human check.

Anything that fails all three becomes a new record and lands in the review queue.

### Run the merge four times before it counts

Each dry run writes to a scratch index and produces a diff against the previous run.
The point is to find rules that produce surprises, not to get the data perfect by hand.
The third dry run is the one the cataloguing team reviews in full.

<Callout tone="decision" title="Shelf marks are never rewritten">
  When two records disagree on a mark, the merge keeps the oldest system's mark and
  records the other as an alias. A reader searching the old mark still finds the item.
</Callout>

### Cut over on a Monday morning

The move itself is an hour of read-only time while the final merge runs. Monday at
eight was chosen because loans are lightest then and the full team is in.

\`\`\`sql
-- Records that still have more than one owner after the third dry run.
select shelf_mark, count(distinct source_system) as owners
from scratch.records
group by shelf_mark
having count(distinct source_system) > 1
order by owners desc, shelf_mark;
\`\`\`

The script runs with \`merge --dry-run --round 3\` and writes its report next to the
scratch index. Press <kbd>Ctrl</kbd> + <kbd>R</kbd> in the review tool to reload a
record after editing its alias list.

## Progress by source

<BarChart
  title="Records merged per dry run, by source catalogue"
  data={[
    { round: "Run 1", oldest: 118000, loans: 41000, subjects: 22000 },
    { round: "Run 2", oldest: 131000, loans: 44500, subjects: 24800 },
    { round: "Run 3", oldest: 139600, loans: 46200, subjects: 26300 },
  ]}
  x="round"
  y={["oldest", "loans", "subjects"]}
  labels={{ oldest: "Oldest catalogue", loans: "Loan system", subjects: "Subject index" }}
  layout="stacked"
  format="compact"
/>

<LineChart
  title="Unresolved conflicts after each run"
  data={[
    { run: "Run 1", conflicts: 9120 },
    { run: "Run 2", conflicts: 6210 },
    { run: "Run 3", conflicts: 4118 },
    { run: "Run 4", conflicts: 2470 },
  ]}
  x="run"
  y="conflicts"
  format="compact"
/>

## Risks

<Callout tone="risk" title="Loan history older than 2019 exists only on paper">
  If the loan system's export is incomplete, the merged index will show items as never
  borrowed. The cataloguing team samples 200 records against the ledgers before run 3.
</Callout>

<Callout tone="warning" title="Subject headings use two vocabularies">
  The subject index mixes local headings with the national list. Merged records keep
  both until the vocabulary work in the second half of the year.
</Callout>

<Callout tone="tip">
  Run the diff on a weekday evening. The scratch index shares a machine with the public
  site, and the diff takes the site to half speed for twenty minutes.
</Callout>

| Risk | Likelihood | Effect | Owner |
|---|---|---|---|
| Export from the oldest catalogue drops diacritics | Likely | 3,000 titles misspelt | Nadia |
| Loan export missing 2019 | Possible | History shows gaps | Tomas |
| Cut-over overruns the hour | Unlikely | Reading room read-only until noon | Priya |
| Shelf-mark aliases confuse the request slip printer | Possible | Wrong shelf on slips | Nadia |

## Who does what

<Checklist title="Before run 3">
  <Todo task="normalise-marks" checked owner="Nadia" due="Week 2">Normalise shelf marks in the oldest export</Todo>
  <Todo task="loan-export" checked owner="Tomas" due="Week 2">Confirm the loan export covers 2019 to today</Todo>
  <Todo task="ledger-sample" owner="Priya" due="Week 4">Sample 200 records against the paper ledgers</Todo>
  <Todo task="alias-format" label="Agree the alias format with the slip printer vendor" owner="Nadia" due="Week 4">
    The printer truncates at 24 characters. Aliases longer than that need a short form.
  </Todo>
  <Todo task="rehearsal" owner="Tomas" due="Week 5">Rehearse the cut-over on the scratch machine</Todo>
</Checklist>

Status at the time of writing: run 1 and run 2 <Status tone="done" />, run 3
<Status tone="on-track" />, vendor conversation <Status tone="at-risk" />, cut-over
<Status tone="not-started" />.

<Timeline>
  <Milestone date="Week 1" title="Exports in hand" state="done" />
  <Milestone date="Week 3" title="Dry run 2 reviewed" state="done">
    Found the diacritics problem. Fixed in the export, not in the merge.
  </Milestone>
  <Milestone date="Week 5" title="Dry run 3 signed off" state="active" />
  <Milestone date="Week 7" title="Rehearsal on the scratch machine" state="planned" />
  <Milestone date="Week 8" title="Cut-over, Monday 08:00" state="planned" />
</Timeline>

## Comparison of search engines considered

<DataTable
  caption="Three candidates measured on the run-2 scratch index, 212,400 records."
  data={[
    { engine: "Built-in", median: 0.42, p95: 1.9, memory: 1.2, reindex: 11 },
    { engine: "Separate service", median: 0.18, p95: 0.6, memory: 2.8, reindex: 4 },
    { engine: "Hosted", median: 0.21, p95: 0.7, memory: 0, reindex: 6 },
  ]}
  columns={[
    { key: "engine", label: "Engine" },
    { key: "median", label: "Median (s)" },
    { key: "p95", label: "95th (s)" },
    { key: "memory", label: "Memory (GB)" },
    { key: "reindex", label: "Reindex (min)" },
  ]}
/>

The built-in engine is the one we keep. It is the slowest of the three, but it is
inside the one-second target and it is the only option with nothing new to run.

---

### Appendix: field mapping

Fields with the same name in all three catalogues map directly. The rest:

- \`call_no\` and \`shelfmark\` both become \`shelf_mark\`.
- \`borrower_id\` becomes \`reader_id\`; the numbering is preserved.
- \`subj\` (a semicolon-separated string) is split into one \`subject\` row per heading.
  - Trailing full stops are removed.
  - Headings that differ only in case are merged.
- \`notes\` is kept as free text. Nothing parses it.

<details>
<summary>Fields that are dropped</summary>

\`legacy_flags\`, \`last_printed\` and \`barcode_old\` have no reader in any current
workflow. They are archived with the final export and not carried into the index.

</details>

#### A note on dates

All three systems store dates as text in three formats. The merge parses each and
stores ISO 8601. Where a date fails to parse it is kept verbatim in \`date_raw\` and the
record goes to the review queue. ~~Dates before 1900 are rejected~~ Dates before 1900
are allowed; the oldest holdings date from 1788.

##### Contact

Questions about the plan go to the cataloguing team lead. Questions about the cut-over
go to whoever is on the rota that Monday, which is on the [shared calendar](#appendix-field-mapping).

###### Revision

Second draft. The first draft proposed a new numbering scheme; the survey ended that.
`;
