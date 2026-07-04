# ADR-0005 — optional custom domain for GitHub Pages deploys

- **Status**: Superseded by [ADR-0006](./0006-github-pages-only.md) — custom domains
  removed before release. This ADR's analysis (free subdomains, `.doc` not registrable,
  per-user vs global) is retained for when custom domains are revisited.
- **Date**: 2026-07-04
- **Amends**: ADR-0001 §D15 (GitHub Pages topology), §D21 (link privacy).

---

## Context

Deploy URLs default to `https://<user>.github.io/planloft-plans/p/<id>/`. Users want
prettier links. GitHub Pages supports custom domains for free (DNS + auto Let's Encrypt),
but two facts constrain the design:

1. A GitHub Pages custom domain attaches to **one repo on one account**. Because planloft
   deploys to each **user's own** `planloft-plans` repo (§D11/§D15), a custom domain is
   necessarily **per user** — each user brings a domain they own. A single global vanity
   domain for everyone's deploys would require reversing §D11 to a central host, which was
   rejected.
2. The domain name itself is **not free** — you register it at a registrar. Vanity TLDs
   like `.doc` are not registrable (`.doc` is not a delegated public TLD; `.docs` exists
   via Google but is not reliably open/free). Truly-free options are subdomain providers
   (e.g. `js.org`, `is-a.dev`). Open paid TLDs: `.dev`/`.app`/`.page`.

## Decision

Support an **optional per-user custom domain** via `config.github.domain`.

When set, the GitHub Pages adapter:
- writes a `CNAME` file (containing the domain) to the repo root,
- best-effort sets the domain + `https_enforced` via `PUT /repos/{u}/{r}/pages`,
- returns `https://<domain>/p/<id>/` (no `/planloft-plans/` base),
- and `basePath()` returns `/p/<id>/`.

When unset (default), behavior is unchanged: `https://<user>.github.io/planloft-plans/p/<id>/`.

DNS is the user's responsibility (documented): apex → GitHub A/AAAA records; subdomain →
`CNAME` to `<user>.github.io`.

## Consequences

- Free (feature-wise) and fully compatible with the per-user model — no central infra.
- Since the page is self-contained (ADR-0003), the base path is cosmetic; only the
  returned URL and the `CNAME` file matter.
- §D21 caveat still holds: the repo is public and browsable regardless of domain.

## Rejected / deferred

- **Global vanity domain** (`planloft.<tld>` for all users) — needs the central-host
  pivot (reverses §D11); revisit only if planloft moves to managed hosting.
- **Auto-registering a domain** — out of scope; planloft never buys domains.
