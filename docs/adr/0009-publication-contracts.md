# ADR-0009 — explicit publication security, comments, and expiry contracts

- **Status**: Accepted
- **Date**: 2026-08-08
- **Supersedes**: ADR-0001 §D12
- **Amends**: ADR-0001 §D19, §D20, §D21, and §D23

## Context

The GitHub Pages adapter promised giscus comments and an interactive PAT fallback but
shipped a comment placeholder and no prompt. TTL validation existed only in Commander,
so configuration and adapter callers could bypass it. Privacy wording also emphasized
an unguessable link without consistently disclosing the enumerable public repository.

## Decision

### P1 — Validate and render opt-in giscus comments

Comments remain off unless `--comments` is present. The effective configuration
requires `repo`, `repoId`, `category`, and `categoryId`. Project fields override global
fields individually. Validate the effective configuration before rendering or Git
operations, escape every rendered attribute, and emit the real giscus client.

GitHub Discussions must be enabled, the giscus app must have repository access, and
the configured category must exist and support giscus. Missing configuration is a
stable `PLANLOFT_GISCUS_CONFIG_INCOMPLETE` failure.

### P2 — Make authentication precedence and interaction exact

Discover credentials in this order: authenticated `gh`,
`PLANLOFT_GITHUB_TOKEN`, `github.token`, then an ephemeral hidden terminal prompt.
Prompt only when stdin and stdout are TTYs. Validate the selected credential through
`gh api user` before repository mutation. Repository lookup, creation, and Pages setup
also use `gh api`, so the runtime does not make its own TLS requests. Noninteractive
failures use stable `PLANLOFT_GITHUB_AUTH_*` codes.

Never print credentials. Do not save prompted credentials. Authenticate Git commands
with an ephemeral `GIT_ASKPASS` helper and environment-scoped credential values while
the persisted fetch and push remote URLs remain clean HTTPS URLs. Delete the helper
immediately after each Git operation.

### P3 — Share one TTL rule and expose exact expiry

`--ttl`, `config.defaultTtlDays`, and adapter inputs accept only finite positive
integers. Use the configured default only when the CLI option is absent. Every deploy
has an expiry; zero never means permanent. Compute expiry from an injectable clock,
return and print its exact ISO timestamp, and retain the existing document ID on
redeploy so the URL stays stable while expiry moves forward.

### P4 — Describe public hosting without access-control implications

The generated path is hard to guess and the page is marked `noindex`. The backing
GitHub repository is public, and repository visitors can enumerate document folders
and manifest metadata. This is not access control; sensitive documents remain local.
Show the same disclosure in help and successful deploy output.

## Consequences

- Publication inputs and credentials fail before GitHub mutation.
- Default artifacts remain comment-free; requested comments either work fully or fail
  actionably.
- CI never waits for a credential prompt and can branch on stable error codes.
- Git configuration never persists token-bearing remote URLs.
- Expiry output is deterministic and redeploy behavior is testable with an injected
  clock.
