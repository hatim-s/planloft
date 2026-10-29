# Planloft domain language

## Document source

Content supplied to Planloft before it has been validated or normalized. A document
source is Markdown, explicitly trusted MDX, a JSON document envelope, or explicitly
trusted HTML.

## Canonical document

Planloft's format-independent representation of one document: metadata plus a
Markdown, MDX, or HTML body. Ingestion adapters produce canonical documents; storage and
rendering consume them.

## Theme

A named set of colors and typography for light and dark modes, written as
`--planloft-*` tokens in one `style.css`. A theme does not supply a template, a layout,
or a document structure. Authors choose the structure of each document.

## MDX snapshot

The minified, self-contained JavaScript bundle that hoist writes beside a stored MDX
document as `<document>.mdx.bundle.js`. It contains the compiled document, its imports,
its registry components, and the component runtime. Stored documents render from their
snapshot, so they stay pinned to the Planloft version and dependencies that compiled
them until they are hoisted again from source.

## Component registry

A `.planloft/components/index.tsx` in the project or `~/.planloft/components/index.tsx`
in the Planloft home. Its exports are available to MDX without imports. Project entries
take precedence over global entries, which take precedence over built-ins.

## Collaboration

Opt-in shared comments, notes, and task checkboxes for an HTML document. A browser
client is attached to the HTML and talks to a separately deployed collaboration service.
Viewers are anonymous and every viewer has the same rights.

## Artifact

The self-contained `index.html` produced by rendering a canonical document with a
theme.

## Hoist

Normalize a document source and persist it in Planloft's per-project global store. For
MDX, hoist also compiles and stores the MDX snapshot.

## Publish

Render a canonical document into an artifact and send that artifact to a host.
