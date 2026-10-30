# 2026-10-30 key decisions: develop directly on staging

**Related:** replaces the PR-into-`staging` flow from [#34 docs structure](../pr-overview/pr34-docs-structure_overview.md) · [CLAUDE.md](../../CLAUDE.md) · [README, "Branches and releasing"](../../README.md#branches-and-releasing)

**Engineer** is the person who works on the app. The **Coding Agent** laid out the options and made the change.

## 1. Commit straight to staging; PRs only for releases

- **Context:** every change, however small, went through a branch, a PR into `staging`, CI and per-PR docs. For one person working on their own app, that was more ceremony than protection.
- **Decision:** work is committed and pushed straight to `staging`. A pull request is opened only to release, `staging` → `main`. Dependabot keeps opening PRs into `staging`, since it can't push.
- **Alternatives:** keep PRs into `staging`.
- **Why:** the Engineer wanted the shorter loop; `main` keeps every protection, so nothing reaches users unchecked.
- **Decided by:** Engineer.

## 2. The staging ruleset keeps only no-deletion and no-force-push

- **Context:** the ruleset required a PR and both CI checks, which refuses a direct push.
- **Decision:** remove the PR and required-check rules; keep the rules against deleting `staging` and force-pushing to it.
- **Alternatives:** remove the ruleset entirely.
- **Why:** direct pushes work, and `staging`'s history still can't be rewritten, which every release PR's merge commit depends on.
- **Decided by:** Engineer.

## 3. CI runs on pull requests only, not on pushes to staging

- **Context:** with no PRs into `staging`, CI would no longer see work until the release PR.
- **Decision:** leave CI on pull requests only. Run `npm test` locally before pushing.
- **Alternatives:** also run CI on every push to `staging`, so a breakage shows at once.
- **Why:** fewer runs; the release PR still has to pass both suites before anything ships.
- **Decided by:** Engineer, against the Coding Agent's recommendation to run CI on pushes.

## 4. Per-change docs: the feature doc, plus decisions named by date

- **Context:** docs were named by PR number, which a direct commit doesn't have.
- **Decision:** every change updates its feature doc in the same commit. A change with real design choices adds `<YYYY-MM-DD>-<slug>_decisions.md`. No per-change spec or overview. Earlier PR-numbered files stay as history.
- **Alternatives:** keep spec, decisions and overview, named by date; feature docs only.
- **Why:** the feature doc already says what a feature does now; the decisions are the part that can't be read back from the code.
- **Decided by:** Engineer.

## 5. The feature-workflow skills are removed

- **Context:** `/feature-workflow` and `/feature-workflow-afk`, and the workflow file they followed, were built around draft PRs and a stop at each PR.
- **Decision:** remove both skills and `.claude/workflows/`.
- **Alternatives:** rework them so slices land as commits on `staging`, with a push gate instead of a PR gate.
- **Why:** the Engineer no longer wants them.
- **Decided by:** Engineer.
