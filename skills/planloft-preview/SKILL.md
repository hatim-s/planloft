---
name: planloft-preview
description: Build and open a local themed preview of a saved planloft document or plan with `planloft preview`. Use when the user asks to preview, inspect, render, or open the latest or named planloft doc before copying or deploying it.
---

# Planloft Preview

## Workflow

Run from the current project repo:

```bash
planloft preview [slug]
```

If the user did not provide a slug, omit it so planloft previews the latest document for
the current project. Report the browser/open result or the exact CLI error.

Do not copy or deploy from this skill unless the user asks for that as a separate step.
