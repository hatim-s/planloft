# ADR-0014 — deep configuration, persistence, and publication modules

- **Status**: Accepted
- **Date**: 2026-08-08
- **Amends**: ADR-0007 §F4–F5, ADR-0009 §P1–P4, ADR-0010 §H1–H2,
  ADR-0011 §I1–I3, and ADR-0013 §H4–H7

## Context

ADR-0013 established one asynchronous application interface, but its implementation
still coordinated shallow helpers for configuration, store/index mutation, rendering,
authentication, and GitHub Pages. The CLI and Node application callers shared command
behavior, while policy knowledge remained spread across the application and host
adapter. That limited locality and made effect ordering difficult to verify through
the same seams callers use.

## Decision

### I1 — One validated configuration interface

`PlanloftConfiguration` owns strict parsing, absent-file defaults, diagnostics, atomic
persistence, targeted updates, project overrides, theme validation/resolution,
authoring templates, and redacted diagnostic snapshots. Application, persistence,
publication, and tests use this interface. Raw credentials remain internal and never
enter application results.

### I2 — One document persistence interface

`DocumentPersistence` owns project/index lifecycle, canonical source serialization,
direct hoisting, Markdown write-direct capture, legacy HTML indexing, metadata
preservation, format replacement, latest/slug lookup, exact-byte Git-root copy, and
removal. Every application storage operation uses this interface.

The public `hoistDocument` compiler export remains, but delegates to this implementation.
The former `core/store`, `core/hoist`, and behavior-bearing document normalization
helpers are removed rather than retained as alternate paths.

### I3 — One publication interface with a narrow host adapter

`PublicationModule` owns TTL and expiry, comment configuration, theme/render policy,
credential acquisition and validation, privacy disclosure, manifest mutation, and host
invocation. A test adapter can exercise publication without GitHub. The real GitHub
Pages adapter receives validated authentication and policy callbacks and owns only
repository, clone, scaffold, Git, Pages, and artifact-copy mechanics.

Manifest mutation is supplied to the adapter as a callback. Rendering is likewise
supplied as a callback so an adapter that discovers an existing stable deployment ID
can render the final artifact for that ID without taking ownership of rendering policy.

### I4 — Public surface remains the application and compiler interfaces

The three deep modules are implementation seams, not additional package-root products.
Node callers use `createPlanloftApplication`; focused compiler callers retain
`ingestDocument`, `hoistDocument`, and `renderDocument`. Packed declarations expose the
application result/adapter vocabulary required by those interfaces, not store,
credential, manifest, host, or module implementation types.

## Consequences

- CLI and Node callers reach the same configuration, persistence, and publication
  implementations.
- Publication preflight validates all locally knowable policy before publish hoists a
  document, and the GitHub adapter can be replaced by an in-memory adapter in tests.
- Every artifact continues to include light/dark support, the top theme control, and
  browser preference fallback because publication calls the canonical renderer.
- Breaking internal imports are intentional; there are no compatibility wrappers for
  the removed shallow modules.
