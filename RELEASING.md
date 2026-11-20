# Releasing

Releases are published to npm by the **Release** workflow
(`.github/workflows/release.yml`) when a version tag `v*` is pushed. Publishing
uses npm **Trusted Publishing (OIDC)** — there is no long-lived `NPM_TOKEN`
secret — and attaches provenance.

## Cutting a release

1. Bump `version` in `package.json` and add the matching section to
   `CHANGELOG.md`.
2. Commit, then tag and push:

   ```bash
   git tag v<version>
   git push origin main v<version>
   ```

3. The workflow installs, builds, tests, checks that the tag equals
   `v` + `package.json` version, and runs
   `npm publish --access public --provenance`.

The release checks are `pnpm lint`, `pnpm check-types`, `pnpm test` and
`pnpm build`. The timing tests (`pnpm test:perf`) are internal and not a
release check: their results depend on the machine.

## One-time setup

Trusted Publishing is attached to an existing package on npmjs.com:

1. Open <https://www.npmjs.com/package/@cycanics/unspoof/access>
   (package **Settings**).
2. Under **Trusted Publisher**, choose **GitHub Actions** and enter:
   - **Organization or user:** `cycanics`
   - **Repository:** `unspoof`
   - **Workflow filename:** `release.yml`
   - **Environment:** _(leave blank)_
3. Save.

The very first version was published manually (`npm publish --access public`,
no `--provenance` — provenance only works from CI) so that the package exists.

## Verifying a package locally

```bash
pnpm build
pnpm publint     # exports/packaging sanity
pnpm attw        # are-the-types-wrong: ESM/CJS type resolution
npm pack --dry-run   # inspect exactly what ships
```
