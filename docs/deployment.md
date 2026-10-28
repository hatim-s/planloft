# Deploy to Vercel, Cloudflare, or GitHub Pages

All hosts use the same `planloft-plans` GitHub repository. A deploy updates one plan
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
is still required because all hosts store pages in the same GitHub repository.
Printed configuration redacts both providers' tokens.

```sh
planloft publish proposal.md --host vercel
planloft deploy architecture-roadmap --host vercel
```

Planloft links or creates the named Vercel project, deploys the repository to
production, and assigns its stable domain. The example project serves pages at
`https://hatims-planloft.vercel.app/<slug>/`. The project name must be available in
your Vercel account. To use a domain you already own, configure `vercel.url` as an
HTTPS origin and add the domain and DNS records in Vercel first. All pages share it.

Vercel failures do not undo a successful Git push. Fix the reported provider problem
and retry the same deploy. Existing page IDs remain stable.

## Cloudflare setup

Install Wrangler and run `wrangler login`, or set `CLOUDFLARE_API_TOKEN` in the environment. GitHub authentication is also required. Configure the worker name, account ID, and its existing stable workers.dev origin:

```json
{
  "host": "cloudflare",
  "cloudflare": {
    "worker": "my-plans",
    "accountId": "0123456789abcdef0123456789abcdef",
    "url": "https://my-plans.example.workers.dev"
  }
}
```

Enable the account's workers.dev subdomain first. Planloft deploys the complete `public/` directory using Wrangler. It does not store the Cloudflare token. Verify that the configured URL is the worker's actual workers.dev URL. A failed deployment may follow a successful Git push; retry the deploy.

## Repository layout and one-way migration to Vercel

`migrate-to-vercel` upgrades legacy and version 2 repositories to the shared version 3 layout. It changes local files only. Existing pages and assets stay at `/p/<id>/` so their relative links and scripts retain the same base URL. A slug landing redirects to that original page until you deploy the document again from its source. Re-deployment renders at the slug and changes the old ID page into a redirect to it. Linking and deploying a host are separate steps. The command retains its existing name.

The shared layout contains:

```text
public/
  index.html
  .nojekyll
  <slug>/index.html
  p/<id>/index.html  # original page until re-deployed, then redirect
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
into `public/`. It adds slug landings while retaining original document bytes, assets, IDs, expiry records, Git
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
refuses duplicate slugs across projects, reserved slugs, path collisions, symbolic links, invalid manifests, and missing plan files.
Repeat runs retain the migrated layout. There is no reverse migration command; Git
history retains the old structure. Use this version of Planloft after migrating.
Older versions write pages to the wrong directory.

## GitHub Pages

Use `--host github-pages`, or omit `--host` and keep the default configuration.
GitHub Pages serves `https://<owner>.github.io/<repo>/<slug>/`.

The repository now publishes `public/` through GitHub Actions. Planloft attempts to
switch Pages to that mode on a GitHub Pages deploy. After a manual migration, choose
**GitHub Actions** in repository Settings > Pages, then run `planloft-pages` once.
All providers can serve the same repository at the same time.

## Expiry and scheduled deployment

The daily pruning workflow removes expired `public/<slug>/` and `public/p/<id>/` folders, updates the
manifest and any existing index generator, and pushes the result. It explicitly
dispatches the Pages workflow because pushes using `GITHUB_TOKEN` do not trigger
another workflow.

For Vercel, connect the repository to the project in Vercel's Git settings. Create a
production deploy hook for `main` and save its URL as the GitHub repository Actions
secret `PLANLOFT_VERCEL_DEPLOY_HOOK`. The pruning workflow calls it after a change.
Without this hook, scheduled pruning updates Git but the Vercel site keeps the old
pages until the next deployment. Cloudflare deployments must be rerun after scheduled pruning to remove expired pages from the live Worker. TTL is scheduled cleanup, not access control.

Vercel's static configuration follows its [project configuration reference](https://vercel.com/docs/project-configuration).
Token and scope handling follow the [CLI global options](https://vercel.com/docs/cli/global-options).

Cloudflare success is verified against the deployment targets in Wrangler’s structured output. If the configured URL differs, Planloft reports an error. The Worker and Git repository may already have been updated; correct the URL and deploy again.
