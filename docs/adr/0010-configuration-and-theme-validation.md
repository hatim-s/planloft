# ADR-0010 — strict configuration and explicit theme resolution

- **Status**: Accepted
- **Date**: 2026-08-08
- **Amends**: ADR-0001 §D3, §D7, §D8, and §D23; ADR-0007 §F3

## Context

Configuration loading previously merged any parsed object with defaults and treated only
`ENOENT` specially. That made partial and unsupported configurations appear valid, while
read and JSON failures leaked unstable platform errors. Configuration writes replaced the
file directly, and the editor command did not validate what the editor left behind.

Theme resolution returned a built-in path whether or not that directory existed. Theme
asset readers then caught every error and silently supplied defaults, making an unknown,
inaccessible, or structurally invalid theme look like a valid empty theme.

## Decision

### H1 — Version and validate the complete configuration

`config.json` is a strict version-1 object whose required fields are `version`, `theme`,
`planFormat`, `defaultTtlDays`, and `projects`. `schemas/config.schema.json` is the manual
editing contract. Unknown properties, unsupported versions, invalid theme names, invalid
TTL values, and wrongly typed nested settings are semantic errors.

Defaults apply only when `config.json` is absent. Malformed JSON, inaccessible files, and
semantic failures produce stable diagnostic codes. Saving validates first and uses a
same-directory temporary file plus rename. Targeted updates merge nested settings so they
do not erase unrelated valid configuration. `planloft config` validates again after the
editor exits.

### H2 — Resolve only real themes

A theme name resolves to a real directory, with a user directory taking precedence over a
built-in directory. Invalid names, missing directories, inaccessible paths, inaccessible
assets, and invalid constrained layouts are distinct failures. Missing-theme diagnostics
list the available built-in and user themes.

`template.md`, `style.css`, and `layout.html` remain optional, but their documented defaults
apply only after the containing theme directory has resolved. A present layout must include
`{{body}}` and may use only the documented slots. Document hoisting and agent-path
resolution validate the effective theme before writing document or index state.

## Consequences

- Existing unversioned or partial configuration must be updated instead of being silently
  repaired at runtime.
- A misspelled theme cannot produce a generic-looking document under an unusable name.
- User theme directories can intentionally override a built-in and omit optional assets.
- Manual edits fail immediately and consistently without destroying the invalid file, so
  the user can correct it.
