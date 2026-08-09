# ADR-0015 — focused Planloft explanation and theme-customization skill

- **Status**: Accepted
- **Date**: 2026-08-09
- **Amends**: ADR-0008 G1 and G6; ADR-0012 installation inventory

## Context

ADR-0008 removed shallow preview, copy, and deploy wrapper skills and retained
`write-doc` as the only semantic skill. That keeps document operations in the CLI,
but it leaves two related jobs without durable, discoverable guidance: explaining the
canonical document pipeline and creating a valid custom theme.

Theme work is not a one-command wrapper. It requires coordinated knowledge of theme
resolution, three optional assets, constrained layout slots, light/dark behavior,
configuration precedence, and local visual validation. Putting that material back in
the README makes installation difficult to scan and does not help an agent apply it.

## Decision

### I1 — Ship two focused skills

Keep `write-doc` narrowly responsible for authoring and persisting substantial plans.
Add `customize` for:

- explaining ingestion, storage, rendering, and publication boundaries;
- selecting and configuring themes;
- creating, modifying, validating, and troubleshooting custom themes.

Do not add wrapper skills for render, hoist, preview, copy, deploy, or other CLI
commands. `planloft help` remains the operational discovery boundary.

### I2 — Use progressive disclosure

Keep the skill workflow concise. Load separate references for the document pipeline and
the theme contract only when relevant. Ship a complete theme starter as an asset so an
agent can adapt a valid dual-theme baseline instead of reconstructing it.

### I3 — Preserve setup and safety boundaries

Install each skill explicitly through the external skills runner. Skill installation
does not install the Planloft executable or runtime assets. Theme mutation and
validation require the CLI on `PATH`; explanation-only use does not.

Theme validation is local. The skill must never publish or deploy a validation document
without explicit user authorization. It must preserve unrelated configuration and
existing theme files.

## Consequences

- The npm package and repository expose `write-doc` and `customize`; OpenAI UI metadata
  labels them `planloft:write-doc` and `planloft:customize`.
- The README can remain installation-focused while detailed customization knowledge
  ships close to the runtime it describes.
- The customization skill can evolve with the renderer and theme contract without
  expanding the plan-authoring context.
- Installer and distribution tests must distinguish source discovery of two skills
  from installation of one explicitly selected skill.
