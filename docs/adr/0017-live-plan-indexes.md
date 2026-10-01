# ADR-0017: live plan indexes

- **Status**: Accepted
- **Date**: 2026-09-23
- **Amends**: ADR-0001 §D14, §D21

## Context

GitHub Pages publishes one document per deployment and removes expired deployments with a
daily prune. The repository had no managed listing of the deployments that were still
live. People had to know a generated path or inspect the manifest to find them.

The generated repository is public. A public index improves discovery, but it does not
protect the documents it lists. The index must also be safe to regenerate from manifest
data and must not change the branch that GitHub Pages publishes.

## Decision

### L1: Regenerate both indexes on every publication event

Every GitHub Pages deploy and every daily expiry prune regenerates the managed README
active index in the root `README.md` and a root `index.html`. Both are built from all
unexpired deployments in `manifest.json`. A deployment is unexpired when `expiresAt` is
`null` or later than the operation clock.

A deploy passes its injected publication clock to the index generator. The prune captures
one operation clock and uses it for both expiry filtering and index generation. The prune
prepares and validates both output files before it removes expired folders or rewrites
the manifest, then writes the prepared output.

The `main` branch remains the publication contract. The manifest, plan folders, README,
and HTML index are committed and pushed to `main`, which remains the GitHub Pages source.
The index does not introduce another branch or a separate Pages build.

### L2: Make generated output safe and repeatable

The output is escaped, symlink-safe, and deterministic. Escape manifest values before
placing them in Markdown or HTML, and encode deployment IDs in URLs. Sort active
deployments by project, title, and ID. The same manifest and operation clock produce the
same output. Update only the marked README section and preserve the rest of the file.

Treat `README.md` and `index.html` as regular files. Refuse to read or write either path
when it is a symbolic link or is not a regular file. This keeps a generated index from
following a link outside the deployment repository.

### L3: Keep noindex and the public repository boundary

Keep `noindex` on published plan pages and on the generated root index. The root index
and the repository README are public. They increase discoverability, but they are not
access control. Anyone who finds the repository can enumerate its unexpired deployments
and their metadata. Keep sensitive documents local.

## Consequences

- The repository README and the Pages root give people a current way to find live
  deployments.
- Deploys and prunes can commit refreshed indexes. Repeated runs are idempotent when the
  generated content is unchanged.
- A deployment ID stays stable while its manifest entry exists. Expiry pruning removes
  that entry, so a later redeploy is a new publication with a new URL.
- The prune rejects invalid manifests and unsafe output paths before mutating deployment
  folders or the manifest.
- Escaping, stable ordering, and no-follow writes make generated diffs predictable and
  keep manifest values from becoming markup.
- Public discoverability increases for every live deployment. This is not a privacy or
  authorization boundary.

## Rejected alternatives

- Keep a bare Pages root. This preserves the old D14 behavior but makes live deployments
  hard to find.
- Regenerate indexes only during deploy. Expiry pruning would leave links for deployments
  that no longer exist.
- Build the index from the `p/` directories. The directories do not provide a complete,
  authoritative expiry record; the manifest does.
- Mutate the repository before preparing the output. A rendering or validation failure
  could leave the manifest, folders, and indexes out of sync.
- Put the generated site on a separate branch or a Pages workflow. That would replace the
  existing `main` branch contract with another source of truth.
- Treat an unguessable URL or a public index as access control. Neither prevents someone
  who can reach the public repository from enumerating its contents.
