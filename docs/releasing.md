# Release Planloft

Run releases from a clean, up-to-date `main` checkout:

```bash
npm login
bun run release 0.2.5
```

Replace `0.2.5` with the version you want to publish. The command accepts stable
`major.minor.patch` versions only.

The release command:

1. Checks npm authentication, the branch, the remote commit, npm, and Git tags.
2. Updates `package.json` with the requested version.
3. Runs the source tests, typecheck, public API check, and 12 local installer scenarios.
4. Builds and validates one npm tarball, then runs an npm publish dry run.
5. Commits and pushes `main` with the message `Release <version>`.
6. Publishes that tarball, verifies its SHA-1, and pushes `v<version>`.
7. Runs 12 remote skill installation scenarios across the latest branch and new tag
   with four workers.

The command stops before changing `package.json` if npm authentication or the release
destinations are not ready. It also stops before publication if any test, build,
package, commit, or push step fails.

Rerun the same explicit version after an interruption. If npm and the Git tag already
exist, the command verifies the released skills without publishing again.

The remote installer check runs after publication because it needs the new tag. A
failure there does not undo the npm package or tag. Rerunning the same version repeats
only that verification.
