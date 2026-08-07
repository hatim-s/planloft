# Authoring guidance — detailed

Author Markdown only. Never hand-author HTML or generated presentation markup.

Write a thorough technical plan a teammate could execute without asking questions.

Use these sections (drop a section only if truly N/A):

## Context
What exists today, why this work is needed, constraints.

## Approach
The chosen strategy and the key decision(s) behind it. Note alternatives rejected.

## Steps
Numbered, ordered implementation steps. Each step names the files/modules touched and
the concrete change. Call out ordering dependencies.

## Risks & mitigations
Real failure modes and how each is handled.

## Open questions
Anything unresolved that needs a decision.

Rules:

- Be specific: name files, functions, commands.
- Prefer tables for structured trade-offs.
- Keep prose tight, but do not omit reasoning.
- Keep presentation color-free so the rendered document works in light and dark themes.
