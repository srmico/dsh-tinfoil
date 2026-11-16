# Releasing

Packages are released in lockstep from GitHub. The root meta-bundle and the seven plugins share one
version; the private `@srmico/dsh-tinfoil-lib` package follows the same version but is never published.

This repository deliberately uses GitHub-native permissions and manual workflows instead of release
scripts or bot-driven version PRs. The examples assume the default branch is `main`; substitute the
repository's default branch where needed.

## Hosting

GitHub remains the release host because npm Trusted Publishing and provenance require a supported
OIDC issuer, and GitHub-hosted runners provide the capacity this build needs. The GitHub repository
must be public for provenance, and the `@srmico` npm scope must be owned with 2FA enabled. Codeberg
was evaluated and would require a long-lived npm token, no npm provenance, and either limited hosted
runners or a self-hosted runner. Revisit that trade-off only if the project moves its primary hosting.

## Maintainer model

The maintainer list is the GitHub access list, not a separate allowlist in a workflow file.

- **Maintainers** are collaborators or organization team members with **Write** (or Maintain/Admin)
  permission. They can push branches, create tags, and run manual workflows.
- **Public contributors** can read, fork, and open pull requests, but cannot push branches to this
  repository.
- A fork push happens in the contributor's repository and triggers nothing here.
- A PR that modifies `.github/workflows/` cannot alter the workflow used for manual PR CI, because
  manual PR CI runs the workflow from `main`.
- Keep the Write list small: a branch push runs the workflow file from that branch, so Write is
  permission to execute code.

GitHub restricts `workflow_dispatch` to users with write access. That is the manual-CI and
release-dispatch gate.

## Trigger matrix

| Event | Who | Result |
| --- | --- | --- |
| Push to a branch in this repository | human maintainer | CI runs automatically |
| Push to a branch by a bot | bot | workflow run is skipped, no runner |
| PR opened, updated, reviewed, or commented on | anyone | nothing runs |
| Push of a release tag | anyone | nothing runs |
| Manual CI with a PR number | Write+ maintainer | CI runs on `refs/pull/<n>/head` |
| Manual CI without a PR number | Write+ maintainer | CI runs on the selected branch |
| Manual release dispatch | Write+ maintainer | build → `npm-publish` approval → npm → GitHub Release |

There is no `pull_request`, `pull_request_target`, or `issue_comment` trigger. Review a contributor PR
first, then run CI on it explicitly.

## CI

Workflow: [.github/workflows/ci.yml](../.github/workflows/ci.yml).

Automatic CI runs on maintainer pushes to any branch. Bots are skipped by the job condition. The run:

1. resolves the checkout ref (branch ref, or `refs/pull/<n>/head` for a manual PR run),
2. installs with `pnpm install --frozen-lockfile --ignore-scripts`,
3. checks root dependency pins,
4. runs `pnpm typecheck` and `pnpm build`,
5. runs a recursive `pack --dry-run` and rejects source files, source maps, or `node_modules`.

There is no dependency cache in any workflow.

### Manual CI on a contributor PR

```sh
gh workflow run ci.yml --ref main -f pr=123
```

Or use **Actions → CI → Run workflow**, choose `main`, and enter `123`.

Manual CI has no secrets, a read-only `GITHUB_TOKEN`, no persisted git credentials, no cache, and
install scripts disabled. It still executes the PR's build code on an ephemeral runner. Only run it on
code you are willing to execute. Results are in the Actions logs; it does not create a PR status check.

### Manual CI on a branch

```sh
gh workflow run ci.yml --ref <branch>
```

## Release

Workflow: [.github/workflows/release.yml](../.github/workflows/release.yml).

Tag pushes do not start a workflow. Create and push the tag, then dispatch the release manually:

```sh
gh workflow run release.yml --ref main -f tag=v0.1.0
```

The workflow file comes from `main`; the build checks out the requested tag. The environment's
deployment branch rule must allow `main`, because that is the workflow ref GitHub evaluates; a
tag-only rule would block the publish job.

Jobs:

- **build** — verifies the tag matches the root version, every package shares that version, root
  dependencies are exact and complete, package names are `@srmico/dsh-tinfoil[-<name>]`, public access
  is configured, and `LICENSE`/bundle patches are present. It then typechecks, builds, packs the
  plugins first and the root last, writes `SHA256SUMS`, and uploads the tarball artifact.
- **publish** — waits for the `npm-publish` environment, downloads the exact artifact, and publishes
  each missing version in order. Existing versions are skipped. It uses OIDC with `--provenance`, no
  npm token, an isolated npm config, and `--ignore-scripts`.
- **release** — waits for npm, downloads the same artifact, and creates a GitHub Release with the
  tarballs and `SHA256SUMS`. Prerelease tags get a prerelease; stable tags become `latest`.

The publish job is the only job with `id-token: write`; the release job is the only job with
`contents: write`.

## Version bump

Bump all manifests and exact root pins before tagging:

```sh
VERSION=0.1.1

pnpm -r --include-workspace-root exec \
  npm pkg set version="$VERSION"

for name in audio decisions documents pii provider verification web; do
  npm pkg set "dependencies.@srmico/dsh-tinfoil-$name=$VERSION"
done

pnpm install --lockfile-only
```

Then review the manifest and lockfile diff, run the local build checks, commit as
`release: v$VERSION`, push, and let CI run on the branch.

Exact root pins are required: npm semver ranges can exclude prereleases, and the root must install the
same release as the plugins.

## First release (0.1.0)

npm Trusted Publishing cannot create a package's first version. Bootstrap `0.1.0` once from the
workflow-built tarballs:

1. Apply the committed [repository rulesets](../.github/rulesets/README.md) for `main` and `v*`, and
   configure the `npm-publish` environment with required reviewers and a **`main` branch** deployment
   rule before pushing the tag. The release workflow is dispatched from `main`; the tag is an input
   checked out by the build job, so a `v*` tag-only environment rule would block the publish job.
2. Commit/push `0.1.0`; the maintainer push runs CI.
3. Create and push tag `v0.1.0`; this starts nothing.
4. Dispatch the release:
   ```sh
   gh workflow run release.yml --ref main -f tag=v0.1.0
   ```
5. The build job uploads `dsh-tinfoil-npm-tarballs`; the publish job waits.
6. Download the artifact:
   ```sh
   gh run list --workflow=release.yml --limit 1
   gh run download <run-id> --name dsh-tinfoil-npm-tarballs --dir dist
   ```
7. Bootstrap-publish those exact tarballs with a short-lived classic npm automation token or
   interactive OTP. Publish plugins first and the root last. Use `npm publish ./dist/<tarball> --tag
   latest --ignore-scripts` — the leading `./` matters, because npm otherwise interprets a bare
   `dist/...` path as a GitHub package shorthand. Do not pass `--provenance`. Revoke the token
   immediately afterwards.
8. Add a Trusted Publisher rule for each of the eight packages: GitHub Actions, owner `srmico`,
   repository `dsh-tinfoil`, workflow `release.yml`, environment `npm-publish` (the npm environment
   field may be left blank, but `npm-publish` binds it to the approved environment).
9. Approve `npm-publish`. The job skips already-published versions, then the release job attaches the
   same artifact.

The first real OIDC publish is the next release. A `0.1.1-rc.1` rehearsal is recommended to exercise
OIDC, the `next` channel, and prerelease handling before a stable release.

## Normal and prerelease releases

1. Bump versions and update the exact root pins.
2. Run CI on the branch.
3. Commit and push.
4. Create and push the tag (`vX.Y.Z`), preferably an annotated or signed tag.
5. Dispatch `release.yml` with the tag and approve `npm-publish`.
6. Verify npm dist-tags, the GitHub Release assets, and a fresh profile install.

Stable versions use `latest`. `rc` and `beta` use `next`; `alpha` and `canary` use their matching
channel. Prereleases install with `@srmico/dsh-tinfoil@next`.

## Recovery

- **Partial npm publish:** re-run the failed jobs. Existing versions are skipped and the rest continue.
- **GitHub Release job failed:** re-run failed jobs; the artifact is downloaded again.
- **Trusted Publisher failure:** verify the repository, workflow filename, and package settings, then
  re-run the publish job.
- **Wrong version already published:** deprecate it and publish a new patch; never reuse a version.
- **Wrong tag before any publication:** delete the tag/release, fix, and retag. After publication,
  move forward only.
- **Artifact expired:** re-run within the 30-day retention window; otherwise rebuild from the tag.

## Security checklist

- Maintainer Write list is minimal; no public write access.
- Apply the committed [repository rulesets](../.github/rulesets/README.md): `main` is protected from
  force-pushes/deletions, and `v*` tags are protected from updates/deletions.
- `v*` tags protected; only maintainers can create or move them.
- `npm-publish` environment has required reviewers and a `main` deployment branch rule; the `v*`
  tag is validated by the build job and protected by the tag ruleset.
- No dependency cache in CI; fresh pnpm store each run.
- `pnpm install --frozen-lockfile --ignore-scripts`.
- Third-party actions pinned to full commit SHAs; Dependabot updates them weekly.
- No `NPM_TOKEN`; npm OIDC plus provenance after the one-time bootstrap.
- npm scope and maintainer accounts use 2FA.
- Release tarballs and `SHA256SUMS` come from the same build artifact.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| `pnpm install --frozen-lockfile` fails | The version bump did not update `pnpm-lock.yaml`; run `pnpm install --lockfile-only` and commit it |
| Manual CI cannot run | The workflow file must exist on the selected ref; run it from `main` with `-f pr=<number>` |
| Publish fails with 404/E404 | The npm Trusted Publisher repository/workflow settings do not match `release.yml` |
| Publish fails with 403 | The version already exists or the npm account/token lacks permission |
| Publish job does not wait for approval | Check `npm-publish` required reviewers, “Prevent self-review” (off for a solo maintainer), and administrator bypass (off) |
| `npm publish` tries `git ls-remote ...tgz.git` | Use an absolute tarball path or prefix it with `./`; npm interpreted a bare relative `dist/...` path as a GitHub shorthand |
| GitHub Release already exists | The release job uploads assets with `--clobber`; if the release is immutable, update it manually |
| Pack validation reports source files | A package's `files` allowlist or build output is wrong; fix before tagging |
