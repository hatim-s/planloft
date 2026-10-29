# Release Planloft

Run releases from a clean, up-to-date `main` checkout:

```bash
npm login
bun run release 1.0.0
```

Replace `1.0.0` with the version you want to publish. The command accepts stable
`major.minor.patch` versions only.

For 1.0.0, run the gates in the [1.0.0 release plan](./releases/1.0.0.md#release-plan)
first, then `bun run release 1.0.0`. The checkout needs Node.js 22.15.0 or newer.

## What it checks

Before changing the version, the command confirms that the checkout is clean, on
`main`, and equal to `origin/main`. It also checks whether the npm version or Git tag
already exists and confirms npm authentication for a new release.

After the preflight, it updates `package.json` and runs:

- source tests, including the release argument and static installer contracts
- TypeScript checks for `src`, release scripts, and their tests
- one build followed by checks for the CLI version, public exports, application methods,
  and declarations
- 18 local installer scenarios covering add, list, update, remove, and reinstall
- one npm pack, checks against the actual tarball, a Node consumer import, and an npm
  publish dry run

After those checks pass, the command commits and pushes `main`, publishes the checked
tarball, verifies its SHA-1, and pushes `v<version>`. It then runs
18 remote installer scenarios across the latest branch and new tag with four workers.

The command stops before changing `package.json` if npm authentication or the release
destinations are not ready. It also stops before publication if any test, build,
package, commit, or push step fails.

Rerun the same explicit version after an interruption. If npm and the Git tag already
exist, the command verifies the released skills without publishing again.

The remote installer check runs after publication because it needs the new tag. A
failure there does not undo the npm package or tag. Rerunning the same version repeats
only that verification.
