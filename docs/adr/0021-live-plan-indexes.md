# ADR-0021: Live plan indexes

Status: Accepted

Publication and expiry pruning generate a site index at `public/index.html`
and a managed Active plans section in the hosting repository's README.
The indexes use the same version-1 manifest and operation clock as publication
or pruning. They include entries with no expiry or an expiry after that clock.

The site index links to readable slugs using relative URLs so it works at the
root of a custom domain or under a GitHub Pages repository path. The README
uses the site's configured URL when available, with repository-relative links
as a fallback. Only the marked section of an existing README is replaced.

The shared hosting scaffold installs the generator for GitHub Pages, Vercel,
and Cloudflare. Previously published repositories receive the managed scripts
on their next publication or explicit hosting migration. Planloft manages the
site root index. The indexes list public documents and provide no access control.
