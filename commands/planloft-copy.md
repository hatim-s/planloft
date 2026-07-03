---
name: planloft-copy
description: Copy the latest (or named) plan's raw source from the global store into this repo's ./.planloft/plans/ so it can be committed with the code.
argument-hint: "[slug]"
allowed-tools: Bash(planloft:*)
disable-model-invocation: true
---

# Copy a plan into this repo

```!
planloft copy $ARGUMENTS
```

This drops the raw plan source (`.md`/`.html` per `planFormat`) into
`./.planloft/plans/`. Tell the user where it landed and that it's ready to commit.
