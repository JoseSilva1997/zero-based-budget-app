# House Budget

Electron desktop app (Windows and Linux). UI work follows [DESIGN.md](DESIGN.md).

## Branches and releases

The full flow is in [README.md, "Branches and releasing"](README.md#branches-and-releasing). The rules:

- **Branch from `staging` and open PRs into `staging`.** It is the default branch. Never open a PR into `main` for a feature, fix or dependency bump.
- **`main` is production.** Every merge into it publishes a release to users through the auto-updater. It only takes release PRs from `staging`, and the "Release source" check fails any other.
- **A release PR goes `staging` → `main`**, titled `maj:`, `med:` or `min:` (the version bump; pick the largest change in the batch), and is merged with a **merge commit**, never squash or rebase.
- **`staging` is where work gathers between releases.** Releases happen when the owner decides, not per change. There is no hotfix lane and none is wanted: do not suggest one, or reverts to work around it.
- **Before a release PR**, review the open Dependabot PRs and merge them into `staging`.
- **Never bump `version` in package.json or push a `v*` tag.** CI stamps the version from the tags.
- **Staging builds** (`.github/workflows/staging.yml`) are artifacts, not releases: a separate app "House Budget Staging", versioned `X.Y.Z-staging.N`, with the updater off. Keep it that way, so they never touch the real install or its data.

When a workflow or ruleset changes, update the README section, the comment at the top of the workflow, and this file together.

## Docs

Read [docs/README.md](docs/README.md) before starting a feature or fix PR, and when asked why something works the way it does.
- **Docs:** each feature PR adds a spec, a key-decisions file and an overview in `docs/`, named by its PR number, and updates its feature doc in `docs/features/`. Start with a draft PR to get the number.
- **Data in commits:** this repo is public. Docs, fixtures and tests use invented names, merchants, places, account and card numbers, references and amounts. Real statements stay in the gitignored `bank_statements/`.
