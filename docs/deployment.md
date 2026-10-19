# Deploy to Vercel or GitHub Pages

Both hosts use the same `planloft-plans` GitHub repository. A deploy updates one plan
inside the complete site, commits it, and pushes `main`. Redeploying the same project
and slug keeps its ID and URL. Vercel deploys the whole site to one project.

## Vercel setup

Install Vercel CLI 64 or newer and authenticate once:

```sh
bun add -g vercel
vercel login
```

In `planloft config`, add these fields to the existing configuration:

```json
{
  "host": "vercel",
  "github": { "repo": "planloft-plans" },
  "vercel": { "project": "hatims-planloft" }
}
```

Keep the existing `version`, `theme`, `defaultTtlDays`, and `projects` fields.
`vercel.scope` optionally selects a team. `VERCEL_TOKEN` takes precedence over
`vercel.token`; without either, the CLI uses its existing login. GitHub authentication
is still required because both hosts store pages in the same GitHub repository.
Printed configuration redacts both providers' tokens.

```sh
planloft publish proposal.md --host vercel
planloft deploy architecture-roadmap --host vercel
```

Planloft links or creates the named Vercel project, deploys the repository to
production, and assigns its stable domain. The example project serves pages at
`https://hatims-planloft.vercel.app/p/<id>/`. The project name must be available in
your Vercel account. To use a domain you already own, configure `vercel.url` as an
HTTPS origin and add the domain and DNS records in Vercel first. All pages share it.

Vercel failures do not undo a successful Git push. Fix the reported provider problem
and retry the same deploy. Existing page IDs remain stable.

## Repository layout and one-way migration to Vercel

`migrate-to-vercel` prepares the repository for Vercel and retains GitHub Pages
compatibility. It changes local files; linking a Vercel project and deploying are
separate steps. The command names its destination explicitly so future providers
can have their own migrations.

The shared layout contains:

```text
public/
  index.html
  .nojekyll
  p/<id>/index.html
manifest.json
vercel.json
.planloft/
  layout.json
  prune.mjs
.github/workflows/
  planloft-pages.yml
  prune-plans.yml
```

Only `public/` is published. The repository itself remains public and enumerable.
Migration moves legacy web files, including standalone root HTML pages and assets,
into `public/`. It retains document bytes, IDs, expiry records, relative paths, Git
history, and the root manifest. Existing Planloft index generators are updated to
write `public/index.html`. Managed pruning and deployment files are replaced.

Deploy automatically migrates its managed hosting clone. To migrate a separate
checkout without deploying:

```sh
gh repo clone <owner>/planloft-plans
planloft migrate-to-vercel ./planloft-plans
cd planloft-plans
git diff --stat
git add -A
git commit -m "Move Planloft pages into public"
git push origin main
```

Start with a clean checkout. Review custom workflows before committing. Migration
refuses path collisions, symbolic links, invalid manifests, and missing plan files.
Repeat runs retain the migrated layout. There is no reverse migration command; Git
history retains the old structure. Use this version of Planloft after migrating.
Older versions write pages to the wrong directory.

## GitHub Pages

Use `--host github-pages`, or omit `--host` and keep the default configuration.
GitHub Pages serves `https://<owner>.github.io/<repo>/p/<id>/`.

The repository now publishes `public/` through GitHub Actions. Planloft attempts to
switch Pages to that mode on a GitHub Pages deploy. After a manual migration, choose
**GitHub Actions** in repository Settings > Pages, then run `planloft-pages` once.
Both providers can serve the same repository at the same time.

## Expiry and scheduled deployment

The daily pruning workflow removes expired `public/p/<id>/` folders, updates the
manifest and any existing index generator, and pushes the result. It explicitly
dispatches the Pages workflow because pushes using `GITHUB_TOKEN` do not trigger
another workflow.

For Vercel, connect the repository to the project in Vercel's Git settings. Create a
production deploy hook for `main` and save its URL as the GitHub repository Actions
secret `PLANLOFT_VERCEL_DEPLOY_HOOK`. The pruning workflow calls it after a change.
Without this hook, scheduled pruning updates Git but the Vercel site keeps the old
pages until the next deployment. TTL is scheduled cleanup, not access control.

Vercel's static configuration follows its [project configuration reference](https://vercel.com/docs/project-configuration).
Token and scope handling follow the [CLI global options](https://vercel.com/docs/cli/global-options).
