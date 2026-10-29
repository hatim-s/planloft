# ADR-0019: token-only themes and owned support blocks in trusted HTML

- Status: Accepted
- Date: 2026-10-29
- Supersedes: ADR-0007 §F3 (theme layouts), the `template.md` authoring template in
  ADR-0001 and ADR-0003
- Amends: ADR-0007 §F2 (trusted HTML now receives injected support blocks), ADR-0010
  (theme validation rejects template and layout assets)

## Context

Themes used to carry an authoring template and an optional constrained layout. That
made a theme decide a document's structure, and agents copied the template's sections
into documents where they did not fit. Trusted HTML was published as written, so it got
neither theme colors nor the reader controls.

## Decision

### T1. A theme is tokens only

A theme is one `style.css` that sets the public `--planloft-*` variables for light and
dark modes. Theme resolution rejects `template.md`, `template.mdx`, and `layout.html`
instead of ignoring them. Markdown and MDX render into the shared `.planloft-prose`
shell. Authored HTML keeps its own structure and may opt into `.planloft-prose` and
`.planloft-plan > article`.

### T2. Trusted HTML gets two owned blocks

The renderer parses trusted HTML with parse5 and inserts two blocks at parsed tag
offsets:

- `<!-- planloft-render:head:start -->` … `:end -->` in the head, holding one
  `<style data-planloft-render data-planloft-sha256="…">` with theme, prose, component,
  and control CSS, plus the `noindex` meta when enabled.
- `<!-- planloft-render:controls:start -->` … `:end -->` at the start of the body,
  holding the reader controls.

Every other byte of the authored HTML is kept. Rendering an earlier output again
replaces only complete, well-formed owned blocks whose content and checksum match.
Partial markers, edited blocks, and authored elements that use Planloft's control
attributes are errors rather than guesses. Frameset documents are rejected.

The checksum detects accidental edits. It does not authenticate the author.

## Consequences

- Any custom theme from before this change must be migrated by hand to tokens. There
  is no automatic converter for structural CSS. `planloft-migrate` guides the work.
- Trusted HTML output is no longer byte-identical to its input. It is the input plus
  the two owned blocks, and a re-render is stable.
- Old rendered HTML that contains unmarked controls from an earlier renderer is
  rejected until those controls are removed by hand.

## Rejected

- **Keep layouts as an optional theme asset.** Two ways to own structure, and the
  layout path had almost no users.
- **Strip anything that looks like old Planloft output.** Regex removal can delete
  author code. Only marked, verified blocks are replaced.
- **Leave trusted HTML untouched.** Then HTML documents would not follow the theme or
  get reader controls.
