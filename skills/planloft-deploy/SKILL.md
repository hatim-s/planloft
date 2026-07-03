---
name: planloft-deploy
description: Build and publish the latest or named saved planloft document as a themed review link with `planloft deploy`. Use when the user asks to deploy, publish, share, or create a review URL for a planloft plan/doc.
---

# Planloft Deploy

## Workflow

Run from the current project repo, passing through any user-provided slug or flags:

```bash
planloft deploy [slug] [--host github|vercel] [--ttl <days>] [--comments]
```

Defaults:

- No slug means latest document for the current project.
- GitHub Pages is the default host and uses the configured TTL.
- `--host vercel` creates a permanent deployment.
- `--comments` enables giscus review comments.

Report the deployed URL printed by the CLI. Mention expiry only when the CLI reports a
TTL. Do not deploy unless the user explicitly asked to publish/share/deploy.
