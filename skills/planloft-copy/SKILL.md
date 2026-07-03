---
name: planloft-copy
description: Copy the latest or named saved planloft document's raw source from the global store into the current repository with `planloft copy`. Use when the user asks to copy, vendor, commit, or bring a planloft plan/doc into the repo.
---

# Planloft Copy

## Workflow

Run from the target repo:

```bash
planloft copy [slug]
```

If the user did not provide a slug, omit it so planloft copies the latest document for
the current project. Report the path printed by the CLI and note that the copied source
is ready to review or commit.

Do not deploy from this skill unless the user asks for deployment too.
