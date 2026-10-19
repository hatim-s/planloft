# ADR-0017: shared static hosting for Vercel and GitHub Pages

- Status: Accepted
- Date: 2026-10-19
- Supersedes: ADR-0006 hosting restriction

## Decision

Keep GitHub as shared publication storage. Publish only `public/` using either Vercel
or an Actions-based GitHub Pages deployment. Each document occupies `/p/<id>/` on one
Vercel project and production domain. Preserve stable IDs across hosts and redeploys.

Use the authenticated Vercel CLI to link the shared project, deploy the full static
site, and assign the configured production domain. GitHub Pages remains the default;
`config.host` and explicit `--host` select Vercel. Git pushes precede provider deployment,
so a failed Vercel deployment can leave a committed repository change.

`migrate-to-vercel <directory>` is a one-way migration that moves the legacy web
root into `public/`. The command names Vercel as its destination; future providers
can define their own migrations. It retains manifest
version 1, raw bytes, and relative paths. `.planloft/layout.json` records layout version
2. Old CLI versions must not deploy after migration. No dual-layout writes are kept.

Pruning edits the same static tree, then explicitly dispatches Pages and optionally
calls the Vercel deploy hook. A GitHub token push alone does not redeploy either host.
