# Architecture Decision Records

This directory records the significant architectural decisions for **planloft**.

These ADRs are development docs: public in the source repository, but intentionally
outside the consumer install and npm package surface. Keep README, plugin metadata,
slash commands, skills, and CLI help focused on shipped behavior.

Each ADR captures the context, the decision, its consequences, and the alternatives
that were rejected — so future contributors (human or agent) understand *why* the code
is shaped the way it is, not just *what* it does.

| ADR | Title | Status |
|-----|-------|--------|
| [0001](./0001-planloft-architecture.md) | planloft foundational architecture | Accepted |
| [0002](./0002-document-kinds.md) | generalize the store from plans to documents | Accepted (amends 0001 §D3, §D6) |
| [0003](./0003-marked-renderer.md) | replace Astro with a minimal `marked` renderer | Accepted (supersedes 0001 §D10, §D25) |
| [0004](./0004-codex-plugin-support.md) | add Codex plugin support | Accepted (amends 0001 §D1, §D6, §D16) |
| [0005](./0005-custom-domain.md) | optional custom domain for GitHub Pages deploys | Superseded by 0006 |
| [0006](./0006-github-pages-only.md) | narrow active hosting scope to GitHub Pages | Accepted (supersedes 0005; amends 0001 §D11) |

## Conventions

- One ADR per meaningful decision cluster. ADR-0001 is a **foundational** record that
  captures the full initial design as a numbered decision log (D1–D26), because these
  decisions were made together in one design session and are tightly interdependent.
- Later, orthogonal decisions get their own numbered file (0002, 0003, …).
- Never edit a decision's substance after it's Accepted. To change it, add a new ADR
  that supersedes it and update the Status of the old one to `Superseded by NNNN`.
