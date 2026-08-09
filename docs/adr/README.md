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
| [0001](./0001-planloft-architecture.md) | planloft foundational architecture | Accepted (D9 superseded by 0011; D17 amended by 0011) |
| [0002](./0002-document-kinds.md) | generalize the store from plans to documents | Accepted (amends 0001 §D3, §D6) |
| [0003](./0003-marked-renderer.md) | replace Astro with a minimal `marked` renderer | Accepted (supersedes 0001 §D10, §D25; partially superseded by 0007) |
| [0004](./0004-codex-plugin-support.md) | add Codex plugin support | Accepted (amends 0001 §D1, §D6, §D16) |
| [0005](./0005-custom-domain.md) | optional custom domain for GitHub Pages deploys | Superseded by 0006 |
| [0006](./0006-github-pages-only.md) | narrow active hosting scope to GitHub Pages | Accepted (supersedes 0005; amends 0001 §D11) |
| [0007](./0007-document-pipeline.md) | canonical document pipeline and constrained theme layouts | Accepted (amends 0001, 0002; partially supersedes 0003; amended by 0011) |
| [0008](./0008-single-skill-command-knowledge.md) | single skill, authoritative command knowledge, and dual-theme output | Accepted (G1 and G6 amended by 0015; supersedes 0002 E4 and 0004's five-skill surface; amends 0001) |
| [0009](./0009-publication-contracts.md) | explicit publication security, comments, and expiry contracts | Accepted (supersedes 0001 D12; amends D19-D21 and D23) |
| [0010](./0010-configuration-and-theme-validation.md) | strict configuration and explicit theme resolution | Accepted (amends 0001, 0007; amended by 0011) |
| [0011](./0011-document-persistence-contracts.md) | Markdown capture and repository-root persistence contracts | Accepted (supersedes 0001 D9; amends 0001 D17, 0007, 0010) |
| [0012](./0012-installation-products-and-external-installer.md) | installation products and the external skills installer | Accepted (inventory amended by 0015; amends 0001 D1 and D23, 0008 G6) |
| [0013](./0013-application-interface-and-cli-seam.md) | application interface and CLI seam | Accepted (amends 0001 D1 and D23, 0008 G2-G3) |
| [0014](./0014-deep-configuration-persistence-publication-modules.md) | deep configuration, persistence, and publication modules | Accepted (amends 0007, 0009, 0010, 0011, 0013) |
| [0015](./0015-planloft-customization-skill.md) | focused Planloft explanation and theme-customization skill | Accepted (amends 0008 and 0012) |

## Conventions

- One ADR per meaningful decision cluster. ADR-0001 is a **foundational** record that
  captures the full initial design as a numbered decision log (D1–D26), because these
  decisions were made together in one design session and are tightly interdependent.
- Later, orthogonal decisions get their own numbered file (0002, 0003, …).
- Never edit a decision's substance after it's Accepted. To change it, add a new ADR
  that supersedes it and update the Status of the old one to `Superseded by NNNN`.
