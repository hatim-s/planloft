# Authoring guidance: detailed

Author Markdown only. Never hand-author HTML or generated presentation markup.

Write a thorough technical plan a teammate could execute without asking questions.

Use these sections. Drop one only when it truly does not apply.

## Context
What exists today, why this work is needed, and the constraints on it.

## Approach
The chosen strategy and the key decisions behind it. Name the alternatives rejected
and say why they lost.

## Steps
Numbered, ordered implementation steps. Each step names the files or modules touched
and the concrete change. Call out ordering dependencies.

## Risks and mitigations
Real failure modes and how each one is handled.

## Open questions
Anything unresolved that still needs a decision.

Rules:

- Be specific. Name files, functions, and commands.
- Use a table for structured trade-offs and a code block for anything a reader would
  copy.
- Keep prose tight, but do not omit reasoning.
- Keep presentation color-free so the rendered document works in light and dark themes.
