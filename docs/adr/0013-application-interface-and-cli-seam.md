# ADR-0013 — application interface and CLI seam

- **Status**: Accepted
- **Date**: 2026-08-08
- **Amends**: ADR-0001 §D1 and §D23, ADR-0008 §G2 and §G3

## Context

Planloft's Commander actions called command functions that mixed operation behavior,
terminal formatting, process exit state, and filesystem or GitHub effects. Node callers
could reuse lower-level compiler functions, but could not invoke the same complete
operations as the CLI. Tests compensated by intercepting `console` and global process
state. That made the executable the implementation boundary instead of one adapter.

The public-interface roadmap requires an application checkpoint before the Phase 4B
configuration, persistence, and publication modules are consolidated. Planloft has one
current human operator, so this decision favors a clean break over compatibility layers
for internal command-handler modules.

## Caller findings

The intended callers are concrete and intentionally few:

1. The CLI is the interactive human interface and the implementation used by `npx`,
   `pnpm dlx`, and `bunx`.
2. Node scripts need typed operation inputs/results without parsing terminal text.
3. Agents use the `write-plan` skill and `planloft resolve`; hook integrations use the
   hidden JSON protocol. They remain CLI callers, not a separate behavioral surface.
4. CI invokes the packaged CLI for installer and distribution verification, and can use
   an injected application host for mutation-free publication tests.

No browser SDK, remote service API, plugin-specific application implementation, or
general dependency-injection framework is needed.

## Decision

### H1 — One application interface

`createPlanloftApplication()` creates the shared implementation for render, hoist,
publish, resolve, list, preview, copy, deploy, remove, config, and init. All methods are
async, including operations whose current implementation is synchronous. This gives
callers one error model and permits later adapters to become asynchronous without a
second breaking transition.

The hidden hook protocol also crosses this seam but is not part of command knowledge or
the public `PlanloftApplication` command vocabulary.

### H2 — The CLI is an adapter

The Commander layer may parse argv and stdin, format terminal text and colors, and set
the process exit code. It calls the application exactly once per command. Code below
that layer must not use `console.*`, set `process.exitCode`, parse argv, or manufacture
terminal-formatted output.

Application operations return discriminated structured results. HTML destined for
stdout is data in a render result; hook JSON is protocol data in a hook result. Their
serialization remains the CLI adapter's responsibility.

### H3 — Stable error taxonomy

Application failures use `PlanloftApplicationError` with a stable category and code.
The categories are:

- `validation`: caller input or document data is invalid.
- `not_found`: a requested stored document does not exist.
- `conflict`: the requested effect would overwrite preserved state.
- `configuration`: configuration is malformed, inaccessible, or semantically invalid.
- `local_effect`: a local filesystem, process, renderer, or tool effect failed.
- `external_effect`: the selected host or remote publication effect failed.
- `internal`: an unexpected adapter/application invariant failed.

Messages remain human-readable diagnostics, not a versioned parsing interface. The
category and `PLANLOFT_APPLICATION_*` code are the programmatic contract. The CLI maps
all application failures to exit code 1; Commander continues to own parser failures.

### H4 — Validation precedes effects

Each operation resolves and validates all locally knowable input before its first
mutation. In particular, publish parses the source, loads configuration, resolves the
theme, TTL, expiry, and optional comments before hoisting. Copy resolves the source and
overwrite conflict before creating its destination. Resolve validates metadata,
configuration, and theme before index or directory writes.

Remote credential and repository checks remain inside the GitHub Pages adapter until
Phase 4B centralizes publication policy. Those checks can themselves require remote or
interactive effects, so they are not represented as pure validation.

### H5 — Structured, secret-free results

Results expose only data needed by callers: document summaries, paths, resolved
authoring context, preview status, deployment URL/expiry/warnings, and redacted config.
Credentials and authentication sources never appear in application results. Host
adapters may receive credentials through validated configuration internally, but the
application narrows their return value before exposing it.

`list` intentionally omits source paths. Hoist and publish return their affected source
path because callers need the newly persisted target. Configuration output replaces a
stored GitHub token with `[redacted]`.

### H6 — Focused injection seams

The factory accepts only dependencies needed by current callers and deterministic
tests:

- `cwd` for project identity and repository-relative operations.
- `planloftHome`, scoped with async-local state so concurrent Node operations do not
  mutate `process.env`.
- `clock` for persistence timestamps, expiry checks, deploy manifests, and hook markers.
- A minimal filesystem capability for adapter-owned reads and writes.
- Publication, ID, browser-open, editor, environment, and GitHub-readiness functions at real
  effect boundaries.

The narrow public publication adapter receives an already rendered artifact plus
secret-free document identity and timing data. The default implementation delegates to
the existing internal `HostAdapter`; injected test adapters never receive configuration
credentials. There is no generic
repository, logger, event bus, transport, or service-container abstraction. Phase 4B
will move configuration, persistence, and publication internals behind their own
cohesive modules; this ADR does not pre-design those implementations.

### H7 — Public types and compatibility

The package root exports the application factory, interface, result/error/dependency
types, and command-knowledge read interface. These are intentional versioned public
types. Implementation helpers, hook types, CLI presenters, Commander construction, and
host internals remain private.

The existing public free functions `ingestDocument`, `hoistDocument`, and
`renderDocument` remain exported and are covered by packed/public-import validation.
They are useful focused compiler interfaces and do not duplicate terminal behavior.
The old `src/commands/*` behavior functions were never package exports; they are
removed without wrappers. Future breaking changes to the three compatibility exports
require an explicit ADR rather than accidental declaration drift.

### H8 — Command knowledge remains authoritative

The typed command-knowledge module continues to drive Commander descriptions and deep
help, README and `write-plan` marked projections, plugin default prompts, and coverage
tests. It is now exported read-only for Node tooling. Application method names and the
knowledge inventory are verified against the CLI command inventory.

## Consequences

- CLI, Node scripts, agents, and CI reach one implementation.
- Application tests no longer intercept console output or process exit state.
- Publication can be exercised with a fake host and deterministic clock without a live
  GitHub mutation.
- Breaking internal command imports are intentional; package-root compiler exports stay
  available for the Phase 4 gate.
- Phase 4B can consolidate configuration, persistence, and publication policies behind
  the established application boundary without changing terminal contracts first.
