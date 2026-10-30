# House Budget

Electron desktop app (Windows and Linux). UI work follows [DESIGN.md](DESIGN.md).

## Branches and releases

The full flow is in [README.md, "Branches and releasing"](README.md#branches-and-releasing). The rules:

- **Develop straight on `staging`**: commit and push to it, no feature branches or PRs. It is the default branch. Its ruleset only forbids deleting it and force-pushing, so never rewrite its history.
- **Run `npm test` before pushing to `staging`.** CI doesn't run on a push there; the suites run on pull requests only, so the release PR is the first place CI sees the work.
- **`main` is production.** Every merge into it publishes a release to users through the auto-updater. It only takes release PRs from `staging`, and the "Release source" check fails any other.
- **A release PR goes `staging` → `main`**, titled `maj:`, `med:` or `min:` (the version bump; pick the largest change in the batch), and is merged with a **merge commit**, never squash or rebase.
- **`staging` is where work gathers between releases.** Releases happen when the owner decides, not per change. There is no hotfix lane and none is wanted: do not suggest one, or reverts to work around it.
- **Dependabot still opens PRs into `staging`**, where CI runs on them. Before a release PR, review them and merge the green ones.
- **Never bump `version` in package.json or push a `v*` tag.** CI stamps the version from the tags.
- **Staging builds** (`.github/workflows/staging.yml`) are artifacts, not releases: a separate app "House Budget Staging", versioned `X.Y.Z-staging.N`, with the updater off. Keep it that way, so they never touch the real install or its data.

When a workflow or ruleset changes, update the README section, the comment at the top of the workflow, and this file together.

## Docs

Read [docs/README.md](docs/README.md) before starting a feature or fix, and when asked why something works the way it does.
- **Docs:** a change updates its feature doc in `docs/features/` (the body and a changelog row) in the same commit. A change with real design choices also adds a key-decisions file in `docs/key-decisions/`, named `<YYYY-MM-DD>-<slug>_decisions.md`. No per-change spec or overview.
- **Data in commits:** this repo is public. Docs, fixtures and tests use invented names, merchants, places, account and card numbers, references and amounts. Real statements stay in the gitignored `bank_statements/`.
