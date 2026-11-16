# Repository rulesets

GitHub does not read ruleset files from a repository automatically. These JSON payloads are the
reviewable policy; apply them with the API or import them in the GitHub UI.

There are two files because a ruleset has one target type:

| File | Target | Protects |
| --- | --- | --- |
| [`main.json`](main.json) | branch | `refs/heads/main`: blocks deletion and force-pushes |
| [`release-tags.json`](release-tags.json) | tag | `refs/tags/v*`: blocks moving or deleting release tags |

## Apply

Recommended, idempotent create-or-update:

```sh
bash .github/rulesets/apply.sh OWNER/REPO
```

The repository is inferred when run from a checkout with a GitHub remote:

```sh
bash .github/rulesets/apply.sh
```

Or use the GitHub UI: **Settings → Rules → Rulesets → New ruleset → Import a ruleset**, then select
each JSON file.

For a first-time API create:

```sh
gh api --method POST repos/OWNER/REPO/rulesets --input .github/rulesets/main.json
gh api --method POST repos/OWNER/REPO/rulesets --input .github/rulesets/release-tags.json
```

To update an existing ruleset, list IDs first and use `PUT`; `apply.sh` does this automatically:

```sh
gh api repos/OWNER/REPO/rulesets --jq '.[] | [.id, .name] | @tsv'
gh api --method PUT repos/OWNER/REPO/rulesets/<id> --input .github/rulesets/<file>.json
```

Applying rulesets is a repository-admin action. Check that no classic branch protection rule already
exists; classic rules and rulesets both apply while both are present.

## Policy notes

- **`main.json` has no bypass actors.** Nobody, including admins, can force-push or delete `main`
  through normal git operations. Normal non-force pushes are still allowed, which keeps the solo
  maintainer workflow and the release runbook working. An admin can still edit or disable the ruleset
  in repository settings; that action is audited.
- **No PR or status-check rule is included on `main`.** CI is deliberately manual for this repository,
  and a required check that never runs would block merges. Add a `pull_request` or
  `required_status_checks` rule later if the team workflow changes.
- **`release-tags.json` blocks updating and deleting `refs/tags/v*`.** The repository-admin bypass
  (`actor_id: 5`, `actor_type: RepositoryRole`, `bypass_mode: always`) is intentional: without it,
  nobody could delete or re-point a bad release tag, including the owner. Admin bypass use is audited.
  Tag creation itself is not restricted beyond normal Write access.
- **The default branch is assumed to be `main`.** If it is renamed or the repository uses another
  default branch, update `main.json`.
- The [GitHub rulesets API](https://docs.github.com/en/rest/repos/rules) is the source of truth for the
  payload shape. Ruleset changes do not apply from a pull request; an admin applies them explicitly.
