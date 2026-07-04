---
name: planloft-deploy
description: Build the latest (or named) plan into a themed static site and publish it to GitHub Pages as a shareable review link.
argument-hint: "[slug] [--ttl <days>] [--comments]"
allowed-tools: Bash(planloft:*)
disable-model-invocation: true
---

# Deploy a plan for review

Run the planloft deploy for the current project. If no slug is given, deploy the latest
plan. Pass through any flags the user provided.

```!
planloft deploy $ARGUMENTS
```

Report the returned URL to the user. Remember:

- Publishes to **GitHub Pages** — free, auto-expires after 30 days (`--ttl 90` to extend;
  redeploy bumps expiry).
- `--comments` wires giscus review comments (GitHub Discussions).
- The plan page is public-by-link: an unguessable id + `noindex`.
