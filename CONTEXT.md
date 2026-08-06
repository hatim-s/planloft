# Planloft domain language

## Document source

Content supplied to Planloft before it has been validated or normalized. A document
source is Markdown, a JSON document envelope, or trusted HTML.

## Canonical document

Planloft's format-independent representation of one document: metadata plus a Markdown
or HTML body. Ingestion adapters produce canonical documents; storage and rendering
consume them.

## Theme

A named authoring template and visual presentation. A theme may contain writing
guidance, CSS, and a constrained HTML layout.

## Artifact

The self-contained `index.html` produced by rendering a canonical document with a
theme.

## Hoist

Normalize a document source and persist it in Planloft's per-project global store.

## Publish

Render a canonical document into an artifact and send that artifact to a host.
