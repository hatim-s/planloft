# ADR-0006 — narrow active hosting scope to GitHub Pages

- **Status**: Accepted
- **Date**: 2026-07-04
- **Supersedes**: [ADR-0005](./0005-custom-domain.md) (custom domains).
- **Amends**: ADR-0001 §D11 (hosting: was "ship GitHub Pages + Vercel now").

---

## Context

Pre-release, we want one deploy path shipped solid rather than several half-built ones.
The GitHub Pages adapter works end-to-end (verified: real repo, Pages, prune Action,
live URL). By contrast, Vercel is a stub, CF Workers is only an idea, and custom domains
(ADR-0005) add config + `CNAME` + DNS + Pages-domain-API surface for little near-term
value — and a *global* vanity domain clashes with the per-user model (§D11/§D15) anyway.

## Decision

**GitHub Pages is the only active host for now.**

1. **Remove custom-domain support entirely.** Delete `config.github.domain`, the `CNAME`
   write, the Pages-domain API call, and the domain branches in `basePath`/`deploy`.
   Deploys are always `https://<user>.github.io/<repo>/p/<id>/`.
2. **Defer Vercel.** Keep `hosts/vercel.ts` (stub) and the `HostAdapter` registry entry so
   the pluggable seam survives, but do **not** expose it: the `--host` CLI flag is removed
   and no public doc mentions Vercel. `deploy` selects the GitHub adapter directly.
3. **CF Workers** is recorded as a *candidate future host*, not built.
4. **Public docs stay GitHub-Pages-only.** README, slash-command docs, and CLI `--help`
   mention only GitHub Pages. Multi-host / custom-domain intent lives **only** in these
   ADRs (internal).

## Consequences

- Smaller public surface; one well-tested path.
- The `HostAdapter` interface + `vercel.ts` remain, so re-enabling a host later is:
  implement `adapter.deploy`, re-add the `--host` flag, write a superseding ADR.
- Re-introducing custom domains means reversing this ADR; the design is preserved in
  ADR-0005.

## Rejected

- **Keep custom-domain code dormant** — dead config/surface users could trip over.
- **Delete the `HostAdapter` seam** — would force rework when Vercel/CF Workers return.
